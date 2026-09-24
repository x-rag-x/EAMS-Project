// State
var TOKEN = getToken();
var currentUser = null;
var currentAction = null;

// Nav Constants
var PAGE_NAMES = [
  "overview",
  "usergrid",
  "broadcasts",
  "data",
  "backup",
  "undo",
  "maintenance",
];

// Guard
(function () {
  currentUser = checkAuth("admin", "controlPage");
  if (!currentUser) return;
  applyControlTabRestrictions();
  refreshExportCount();

  var urlParams = new URLSearchParams(window.location.search);
  var tabParam = urlParams.get('tab') || urlParams.get('page');
  if (tabParam && PAGE_NAMES.indexOf(tabParam) !== -1) {
    nav(tabParam);
  } else {
    nav('overview');
  }
})();

function applyControlTabRestrictions() {
  var backBtn = document.querySelector('.sb-back-btn');
  if (backBtn) {
    if (currentUser && currentUser.role === 'teacher') {
      backBtn.textContent = '← Back to Hub';
    } else {
      backBtn.textContent = '← Back to Dashboard';
    }
  }
}

// Clock
function updateClock() {
  var now = new Date();
  var clockEl = document.getElementById("top-time");
  if (clockEl) {
    clockEl.textContent = now.toLocaleTimeString(
      "en-IN",
      { hour: "2-digit", minute: "2-digit", second: "2-digit" },
    );
  }
}
updateClock();
setInterval(updateClock, 1000);

// Nav
function nav(page) {
  if (PAGE_NAMES.indexOf(page) === -1) page = 'overview';

  if (window.history && window.history.replaceState) {
    var url = new URL(window.location);
    url.searchParams.set('tab', page);
    window.history.replaceState(null, '', url);
  }

  document.querySelectorAll(".pg").forEach(function (el) {
    el.classList.remove("act");
  });
  var pg = document.getElementById("pg-" + page);
  if (pg) pg.classList.add("act");
  document.querySelectorAll(".sb-item").forEach(function (el) {
    el.classList.remove("act");
  });
  var idx = PAGE_NAMES.indexOf(page);
  var items = document.querySelectorAll(".sb-item");
  if (idx >= 0 && items[idx]) items[idx].classList.add("act");

  if (page === "overview") {
    loadOverview();
    loadHealth();
  }
  if (page === "usergrid") {
    ugInit();
  }
  if (page === "broadcasts") {
    loadActiveBroadcastStatus();
    loadBroadcastHistory();
  }
  if (page === "data") refreshExportCount();
  if (page === "backup") loadBackupPage();
  if (page === "undo") loadUndoPage();
  if (page === "maintenance") loadMaintenance();
}

// Overview
function loadOverview() {
  // Show maintenance banner from DB
  apiCall("GET", "/settings/maintenance")
    .then(function (maint) {
      var banner = document.getElementById("maint-banner");
      if (banner) {
        if (maint && maint.active) banner.classList.remove("hidden");
        else banner.classList.add("hidden");
      }
    })
    .catch(function () { });
  var tok = sessionStorage.getItem("eams_token") || TOKEN || "";
  var h = { Authorization: "Bearer " + tok };
  // Fetch real DB stats from server
  if (!tok) {
    var descNoTok = document.getElementById("ov-storage-desc");
    if (descNoTok) descNoTok.textContent = "Not logged in via API — please log out and log back in.";
    logLine("No auth token — log out and log in again to use API features", "warn");
    return;
  }
  fetch("/api/system/dbstats", { headers: h })
    .then(function (r) {
      if (r.status === 401)
        throw new Error("Unauthorized  — token invalid or expired");
      return r.json();
    })
    .then(function (d) {
      if (d.error) {
        logLine("DB stats error: " + d.error, "danger");
        var descErr = document.getElementById("ov-storage-desc");
        if (descErr) descErr.textContent = "Error: " + d.error;
        return;
      }
      // Top cards (optional - only present in some layouts)
      var oDs = document.getElementById("ov-data-size");
      if (oDs) oDs.textContent = (d.dataSize || "—") + " MB";
      var oSs = document.getElementById("ov-storage-size");
      if (oSs) oSs.textContent = (d.storageSize || "—") + " MB";
      var oIs = document.getElementById("ov-index-size");
      if (oIs) oIs.textContent = (d.indexSize || "—") + " MB";
      var oTd = document.getElementById("ov-total-docs");
      if (oTd) oTd.textContent = d.totalDocs || "—";
      // Storage bar (optional - only present in some layouts)
      var bar = document.getElementById("ov-storage-bar");
      var desc = document.getElementById("ov-storage-desc");
      var usedLbl = document.getElementById("ov-used-label");
      var freeLbl = document.getElementById("ov-free-label");
      var totalLbl = document.getElementById("ov-total-label");
      if (bar) {
        var used = parseFloat(d.storageSize);
        var total = d.fsTotalSize ? parseFloat(d.fsTotalSize) : null;
        var free = total ? total - parseFloat(d.fsUsedSize || used) : null;
        var pct = total
          ? Math.min(100, (parseFloat(d.fsUsedSize || used) / total) * 100).toFixed(1)
          : null;
        if (total) {
          bar.style.width = pct + "%";
          bar.style.background =
            pct > 80
              ? "linear-gradient(90deg,#dc2626,#ef4444)"
              : pct > 60
                ? "linear-gradient(90deg,#d97706,#fbbf24)"
                : "linear-gradient(90deg,#2e7d32,#66bb6a)";
          if (desc) desc.textContent = "Disk: " + pct + "% used of " + total + " MB total";
          if (usedLbl) usedLbl.textContent = "Used: " + parseFloat(d.fsUsedSize).toFixed(0) + " MB";
          if (freeLbl) freeLbl.textContent = "Free: " + free.toFixed(0) + " MB";
          if (totalLbl) totalLbl.textContent = "Total: " + total + " MB";
        } else {
          // Atlas free tier — show data size vs 512MB limit
          var limit = 512;
          var usedMB = parseFloat(d.storageSize);
          var pctUsed = Math.min(100, (usedMB / limit) * 100).toFixed(1);
          bar.style.width = pctUsed + "%";
          bar.style.background =
            pctUsed > 80
              ? "linear-gradient(90deg,#dc2626,#ef4444)"
              : pctUsed > 60
                ? "linear-gradient(90deg,#d97706,#fbbf24)"
                : "linear-gradient(90deg,#2e7d32,#66bb6a)";
          if (desc) desc.textContent = "Atlas Free Tier — " + pctUsed + "% of 512 MB used";
          if (usedLbl) usedLbl.textContent = "Used: " + usedMB.toFixed(2) + " MB";
          if (freeLbl) freeLbl.textContent = "Free: " + (limit - usedMB).toFixed(2) + " MB";
          if (totalLbl) totalLbl.textContent = "Total: " + limit + " MB (Atlas Free Tier)";
        }
      }
      // Collection breakdown grid
      var grid = document.getElementById("collection-grid");
      if (grid && d.collStats) {
        grid.innerHTML = d.collStats
          .map(function (c) {
            return (
              '<div style="background:#f8fafc;border-radius:10px;padding:12px 14px;display:flex;align-items:center;gap:10px;">' +
              '<div><div style="font-size:11px;color:var(--tmu);font-weight:600;text-transform:capitalize;">' +
              c.name +
              "</div>" +
              '<div style="font-size:20px;font-weight:800;color:var(--td);">' +
              c.count +
              "</div></div></div>"
            );
          })
          .join("");
      }
      logLine(
        "DB stats loaded  — " +
        d.totalDocs +
        " docs, " +
        d.dataSize +
        " MB data",
        "success",
      );
    })
    .catch(function (err) {
      logLine(
        "Failed to load DB stats: " + (err.message || "network error"),
        "danger",
      );
      var descCatch = document.getElementById("ov-storage-desc");
      if (descCatch) descCatch.textContent = "Could not fetch storage info — check server connection";
    });
}
// Log terminal
function logLine(msg, type) {
  type = type || "info";
  var el = document.getElementById("sys-log");
  if (!el) return;
  var line = document.createElement("div");
  line.className = "terminal-line " + type;
  var ts = new Date().toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  line.innerHTML = '<span class="terminal-prompt">[' + ts + "]</span> " + msg;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}
// Settings
// MAINTENANCE (fully DB-backed)
var _maintData = null;
function loadMaintenance() {
  // Reset UI to loading state
  document.getElementById("ms-active-val").textContent = "Fetching…";
  document.getElementById("ms-active-val").style.color = "var(--tdi)";
  document.getElementById("ms-roles-val").textContent = "…";
  document.getElementById("ms-end-val").textContent = "…";
  document.getElementById("ms-started-val").textContent = "…";
  document.getElementById("ms-msg-val").textContent = "…";
  var tb = document.getElementById("maint-toggle-main-btn");
  tb.disabled = true;
  tb.textContent = "Loading…";
  document.getElementById("maint-log-list").innerHTML =
    '<div style="text-align:center;padding:20px;color:var(--tdi);font-size:13px;">⏱️ Loading logs from database…</div>';
  apiCall("GET", "/settings/maintenance")
    .then(function (d) {
      if (!d || d.error) {
        showToast("⚠️ " + (d && d.error ? d.error : "Load failed"));
        return;
      }
      _maintData = d;
      renderMaintUI(d);
      // Start expiry polling if already active with an end time
      if (d.active && d.endTime) {
        if (Date.now() >= new Date(d.endTime).getTime()) {
          showExpiryDialog(); // already expired — show immediately
        } else {
          startExpiryPolling();
        }
      }
    })
    .catch(function (e) {
      showToast("❌ Failed to load: " + e.message);
      document.getElementById("ms-active-val").textContent = "Error";
      document.getElementById("ms-active-val").style.color = "#dc2626";
      tb.textContent = "Retry";
      tb.disabled = false;
    });
  loadMaintLogs();
  loadServerLogs();
}
function renderMaintUI(d) {
  if (!d) return;
  var isActive = !!d.active;
  var affected = d.affectedRoles || [];
  // — — Status Banner
  var banner = document.getElementById("maint-status-banner");
  var bannerIcon = document.getElementById("maint-banner-icon");
  var bannerTitle = document.getElementById("maint-banner-title");
  var bannerSub = document.getElementById("maint-banner-sub");
  var toggleBtn = document.getElementById("maint-toggle-main-btn");
  toggleBtn.disabled = false;
  if (isActive) {
    banner.style.background = "linear-gradient(135deg,#fff3cd,#fff8e1)";
    banner.style.borderColor = "#f59e0b";
    bannerIcon.textContent = "🛠️";
    bannerTitle.textContent = "Maintenance Mode is ACTIVE";
    var rLabels = affectedRoleLabels(affected);
    bannerSub.textContent =
      (rLabels.length
        ? rLabels.join(", ") + " are blocked."
        : "No roles blocked.") + " Admins retain full access.";
    toggleBtn.textContent = "ℹ️ Disable Maintenance";
    toggleBtn.style.background = "#dc2626";
    toggleBtn.style.color = "#fff";
    var tb = document.getElementById("maint-banner");
    if (tb) tb.classList.remove("hidden");
  } else {
    banner.style.background = "linear-gradient(135deg,#f0fdf4,#ecfdf5)";
    banner.style.borderColor = "#4ade80";
    bannerIcon.textContent = "🛠️";
    bannerTitle.textContent = "System is Online  — All users can log in";
    bannerSub.textContent =
      "Configure roles, end time and message below, then enable.";
    toggleBtn.textContent = "⚠️ Enable Maintenance";
    toggleBtn.style.background = "#f59e0b";
    toggleBtn.style.color = "#fff";
    var tb2 = document.getElementById("maint-banner");
    if (tb2) tb2.classList.add("hidden");
  }
  // — — Form fields
  ["teacher", "student", "subadmin"].forEach(function (r) {
    var cb = document.getElementById("maint-role-" + r);
    if (cb) cb.checked = affected.includes(r);
    updateRoleChip(r);
  });
  // End time — convert UTC — local datetime-local value
  if (d.endTime) {
    var dt = new Date(d.endTime);
    document.getElementById("maint-end-time").value = new Date(
      dt.getTime() - dt.getTimezoneOffset() * 60000,
    )
      .toISOString()
      .slice(0, 16);
    document.getElementById("maint-end-time").style.borderColor = "#e2e8f0";
  } else {
    document.getElementById("maint-end-time").value = "";
  }
  document.getElementById("maint-msg").value = d.message || "";
  // — — State card
  var activeEl = document.getElementById("ms-active-val");
  activeEl.textContent = isActive ? "⚠️ ENABLED" : "⚠️ Disabled";
  activeEl.style.color = isActive ? "#dc2626" : "#16a34a";
  var rLabels2 = affectedRoleLabels(affected);
  document.getElementById("ms-roles-val").textContent = rLabels2.length
    ? rLabels2.join(", ")
    : "None selected";
  document.getElementById("ms-end-val").textContent = d.endTime
    ? fmtDateTime(d.endTime)
    : "⚠️ Not set";
  document.getElementById("ms-started-val").textContent = d.startedAt
    ? fmtDateTime(d.startedAt)
    : isActive
      ? "Now"
      : "ℹ️ ";
  document.getElementById("ms-msg-val").textContent = d.message || "ℹ️ ";
  // — — Role access table
  renderRoleTable(isActive, affected);
}
function affectedRoleLabels(affected) {
  var map = {
    teacher: "Teachers",
    student: "Students",
    subadmin: "Sub-Admins",
  };
  return (affected || []).map(function (r) {
    return map[r] || r;
  });
}
function fmtDateTime(str) {
  try {
    return new Date(str).toLocaleString("en-IN", {
      dateStyle: "medium",
      timeStyle: "short",
      hour12: true,
    });
  } catch (e) {
    return str;
  }
}
function updateRoleChip(role) {
  var cb = document.getElementById("maint-role-" + role);
  var lbl = document.getElementById("role-lbl-" + role);
  var chip = document.getElementById("role-chip-" + role);
  if (!cb || !lbl || !chip) return;
  if (cb.checked) {
    lbl.style.background = "#fff7ed";
    lbl.style.borderColor = "#f59e0b";
    chip.textContent = "Will be blocked";
    chip.style.background = "#fef3c7";
    chip.style.color = "#92400e";
  } else {
    lbl.style.background = "#f8fafc";
    lbl.style.borderColor = "#e2e8f0";
    chip.textContent = "Not blocked";
    chip.style.background = "#f3f4f6";
    chip.style.color = "#6b7280";
  }
}
function getSelectedRoles() {
  return ["teacher", "student", "subadmin"].filter(function (r) {
    var cb = document.getElementById("maint-role-" + r);
    return cb && cb.checked;
  });
}
function saveMaintConfig() {
  var roles = getSelectedRoles();
  var msg = (document.getElementById("maint-msg").value || "").trim();
  var endVal = document.getElementById("maint-end-time").value;
  var endEl = document.getElementById("maint-end-time");
  // Validate required fields
  if (!msg) {
    showToast("⚠️ Message is required.");
    return;
  }
  if (!endVal) {
    endEl.style.borderColor = "#dc2626";
    showToast("⚠️ End date & time is required  — shown as countdown to users.");
    endEl.focus();
    return;
  }
  endEl.style.borderColor = "#e2e8f0";
  var endISO = new Date(endVal).toISOString();
  var payload = {
    value: {
      active: _maintData ? !!_maintData.active : false,
      message: msg,
      affectedRoles: roles,
      endTime: endISO,
      startedAt:
        _maintData && _maintData.startedAt ? _maintData.startedAt : null,
    },
  };
  apiCall("PUT", "/settings/maintenance", { value: payload })
    .then(function (d) {
      if (d && d.error) {
        showToast("❌ " + d.error);
        return;
      }
      _maintData = d;
      renderMaintUI(d);
      showToast("✅ Configuration saved to database");
      logLine(
        "Maintenance config saved  — roles: [" +
        roles.join(", ") +
        "] end: " +
        fmtDateTime(endISO),
        "success",
      );
      loadMaintLogs();
    })
    .catch(function (e) {
      showToast("❌ Save failed: " + e.message);
    });
}
function doToggleMaintenance() {
  if (!_maintData) {
    showToast("⚠️ Settings not loaded yet.");
    return;
  }
  var roles = getSelectedRoles();
  var msg =
    (document.getElementById("maint-msg").value || "").trim() ||
    "System is under maintenance. Please try again later.";
  var endVal = document.getElementById("maint-end-time").value;
  var endEl = document.getElementById("maint-end-time");
  var nowActive = !_maintData.active;
  // Validate before enabling
  if (nowActive) {
    if (roles.length === 0) {
      showToast("⚠️ Select at least one role to block.");
      return;
    }
    if (!endVal) {
      endEl.style.borderColor = "#dc2626";
      showToast(
        "⚠️ End date & time is required to show countdown on maintenance page.",
      );
      endEl.focus();
      return;
    }
  }
  endEl.style.borderColor = "#e2e8f0";
  var endISO = endVal ? new Date(endVal).toISOString() : null;
  var payload = {
    value: {
      active: nowActive,
      message: msg,
      affectedRoles: roles,
      endTime: endISO,
      startedAt: nowActive ? new Date().toISOString() : null,
    },
  };
  var toggleBtn = document.getElementById("maint-toggle-main-btn");
  toggleBtn.disabled = true;
  toggleBtn.textContent = nowActive ? "Enabling…" : "Disabling…";
  apiCall("PUT", "/settings/maintenance", { value: payload })
    .then(function (d) {
      if (d && d.error) {
        showToast("❌ " + d.error);
        toggleBtn.disabled = false;
        return;
      }
      _maintData = d;
      renderMaintUI(d);
      var msg2 = nowActive
        ? "⚠️ Maintenance ENABLED  — " +
        affectedRoleLabels(roles).join(", ") +
        " redirected to maintenance page"
        : "✅ Maintenance DISABLED  — All users can now log in";
      showToast(msg2);
      logLine(
        nowActive ? "MAINTENANCE ENABLED" : "MAINTENANCE DISABLED",
        nowActive ? "warn" : "success",
      );
      loadMaintLogs();
      loadServerLogs();
      // Start expiry polling when enabled; stop when disabled
      if (nowActive && d.endTime) {
        startExpiryPolling();
      } else if (!nowActive && _expiryPollInterval) {
        clearInterval(_expiryPollInterval);
        _expiryPollInterval = null;
        document.getElementById("maint-expiry-modal").classList.remove("open");
      }
    })
    .catch(function (e) {
      showToast("❌ Toggle failed: " + e.message);
      toggleBtn.disabled = false;
    });
}
function setMaintPreset(hours) {
  var end = new Date(Date.now() + hours * 3600000);
  document.getElementById("maint-end-time").value = new Date(
    end.getTime() - end.getTimezoneOffset() * 60000,
  )
    .toISOString()
    .slice(0, 16);
  document.getElementById("maint-end-time").style.borderColor = "#e2e8f0";
  showToast("⏱️ End time set: +" + hours + " hr" + (hours > 1 ? "s" : ""));
}
function selectAllRoles() {
  ["teacher", "student", "subadmin"].forEach(function (r) {
    var cb = document.getElementById("maint-role-" + r);
    if (cb) cb.checked = true;
    updateRoleChip(r);
  });
}
function clearAllRoles() {
  ["teacher", "student", "subadmin"].forEach(function (r) {
    var cb = document.getElementById("maint-role-" + r);
    if (cb) cb.checked = false;
    updateRoleChip(r);
  });
}
function teachersOnly() {
  clearAllRoles();
  var cb = document.getElementById("maint-role-teacher");
  if (cb) cb.checked = true;
  updateRoleChip("teacher");
}
function studentsOnly() {
  clearAllRoles();
  var cb = document.getElementById("maint-role-student");
  if (cb) cb.checked = true;
  updateRoleChip("student");
}
function renderRoleTable(maintActive, affected) {
  affected = affected || [];
  // When maintenance is OFF nobody is blocked regardless of checkbox state
  var roles = [
    {
      role: "Admin",
      icon: "🛠️",
      blocked: false,
      note: "Always has full access",
    },
    {
      role: "Teacher",
      icon: "🧑‍🏫",
      blocked: maintActive && affected.includes("teacher"),
      note:
        maintActive && affected.includes("teacher")
          ? "Blocked  — shown maintenance page"
          : "Full access",
    },
    {
      role: "Student",
      icon: "🎓",
      blocked: maintActive && affected.includes("student"),
      note:
        maintActive && affected.includes("student")
          ? "Blocked  — shown maintenance page"
          : "Full access",
    },
    {
      role: "Sub-Admin",
      icon: "⚠️ — =+",
      blocked: maintActive && affected.includes("subadmin"),
      note:
        maintActive && affected.includes("subadmin")
          ? "Blocked  — shown maintenance page"
          : "Full access",
    },
  ];
  document.getElementById("role-access-table").innerHTML = roles
    .map(function (r) {
      var color = r.blocked ? "#dc2626" : "#16a34a";
      var bg = r.blocked ? "#fef2f2" : "#f0fdf4";
      var status = r.blocked ? "⚠️ Blocked" : "ℹ️ OK";
      return (
        '<div style="display:flex;align-items:center;justify-content:space-between;padding:9px 12px;background:' +
        bg +
        ';border-radius:10px;">' +
        '<div style="display:flex;align-items:center;gap:9px;">' +
        '<span style="font-size:17px;">' +
        r.icon +
        "</span>" +
        '<div><div style="font-weight:600;font-size:12.5px;color:' +
        color +
        ';">' +
        r.role +
        "</div>" +
        '<div style="font-size:10.5px;color:var(--tmu);">' +
        r.note +
        "</div></div></div>" +
        '<span style="font-size:11.5px;font-weight:700;color:' +
        color +
        ';">' +
        status +
        "</span>" +
        "</div>"
      );
    })
    .join("");
}
// — — Maintenance Activity Log (from DB)
function loadMaintLogs() {
  var el = document.getElementById("maint-log-list");
  el.innerHTML =
    '<div style="text-align:center;padding:16px;color:var(--tdi);font-size:12px;">⏱️ Loading from database…</div>';
  apiCall("GET", "/logs?category=maintenance&limit=50")
    .then(function (res) {
      var logs = (res && res.logs) || [];
      if (!logs || !logs.length) {
        el.innerHTML =
          '<div style="text-align:center;padding:24px;color:var(--tdi);font-size:13px;">⚠️ No maintenance events logged yet. Enable/disable maintenance to create logs.</div>';
        return;
      }
      el.innerHTML = logs
        .map(function (l) {
          var isEnable = l.action && l.action.toLowerCase().includes("enabl");
          var isDisable = l.action && l.action.toLowerCase().includes("disabl");
          var dotColor = isEnable
            ? "#f59e0b"
            : isDisable
              ? "#22c55e"
              : "#3b82f6";
          var sev = l.severity || "info";
          var sevColor =
            sev === "warning"
              ? "#f59e0b"
              : sev === "critical"
                ? "#dc2626"
                : "#16a34a";
          return (
            '<div style="display:flex;align-items:flex-start;gap:10px;padding:9px 0;border-bottom:1px solid var(--brl);">' +
            '<div style="width:8px;height:8px;border-radius:50%;background:' +
            dotColor +
            ';flex-shrink:0;margin-top:5px;"></div>' +
            '<div style="flex:1;min-width:0;">' +
            '<div style="font-size:12.5px;font-weight:700;color:var(--td);">' +
            (l.action || "ℹ️ ") +
            "</div>" +
            '<div style="font-size:11px;color:var(--tmu);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' +
            (l.userName || "") +
            (l.details ? " - " + l.details : "") +
            "</div></div>" +
            '<div style="font-size:10px;color:var(--tdi);white-space:nowrap;padding-top:2px;">' +
            fmtDateTime(l.time) +
            "</div>" +
            "</div>"
          );
        })
        .join("");
    })
    .catch(function (e) {
      el.innerHTML =
        '<div style="padding:16px;color:#dc2626;font-size:12px;"> — Failed to load logs: ' +
        e.message +
        "</div>";
    });
}
// — — Server Logs (live Node.js output)
var _srvLogPollInterval = null;
var _srvLogSince = null;
function loadServerLogs() {
  var url =
    "/api/system/serverlogs" +
    (_srvLogSince ? "?since=" + encodeURIComponent(_srvLogSince) : "");
  apiCall("GET", url)
    .then(function (d) {
      if (!d) return;
      // Update meta
      document.getElementById("srv-uptime").textContent = formatUptime(
        d.uptime,
      );
      document.getElementById("srv-mem").textContent = d.memMB + " MB";
      document.getElementById("srv-node").textContent = d.nodeVersion || "ℹ️ ";
      document.getElementById("srv-env").textContent = d.env || "ℹ️ ";
      if (d.logs && d.logs.length) {
        var terminal = document.getElementById("srv-log-terminal");
        var wasBottom =
          terminal.scrollHeight - terminal.scrollTop <=
          terminal.clientHeight + 20;
        // Append new lines
        var frag = d.logs
          .map(function (l) {
            var cls =
              l.level === "error"
                ? "danger"
                : l.level === "warn"
                  ? "warn"
                  : "success";
            // Colour specific patterns
            if (
              l.text.includes("✅ ") ||
              l.text.includes("connected") ||
              l.text.includes("seeded")
            )
              cls = "success";
            if (
              l.text.includes("❌ ") ||
              l.text.includes("error") ||
              l.text.includes("Error")
            )
              cls = "danger";
            if (
              l.text.includes("⚠️") ||
              l.text.includes("warn") ||
              l.text.includes("MAINT")
            )
              cls = "warn";
            if (l.text.includes("🛠️") || l.text.includes("ℹ️")) cls = "info";
            var ts = new Date(l.time).toLocaleTimeString("en-IN", {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            });
            return (
              '<div class="terminal-line ' +
              cls +
              '"><span class="terminal-prompt">[' +
              ts +
              "]</span>" +
              escHtml(l.text) +
              "</div>"
            );
          })
          .join("");
        // On first load, replace; on poll, append
        if (!_srvLogSince) {
          terminal.innerHTML =
            frag || '<div class="terminal-line info">No logs yet.</div>';
        } else {
          terminal.insertAdjacentHTML("beforeend", frag);
          // Keep max 300 lines in DOM
          var lines = terminal.querySelectorAll(".terminal-line");
          if (lines.length > 300)
            for (var i = 0; i < lines.length - 300; i++) lines[i].remove();
        }
        // Track since timestamp
        _srvLogSince = d.logs[d.logs.length - 1].time;
        // Auto-scroll if was at bottom
        if (wasBottom) terminal.scrollTop = terminal.scrollHeight;
      }
    })
    .catch(function (e) {
      if (!_srvLogSince) {
        document.getElementById("srv-log-terminal").innerHTML =
          '<div class="terminal-line danger">Failed to load server logs: ' +
          e.message +
          "</div>";
      }
    });
}
function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
function formatUptime(secs) {
  if (!secs) return "ℹ️ ";
  var h = Math.floor(secs / 3600),
    m = Math.floor((secs % 3600) / 60),
    s = secs % 60;
  if (h > 0) return h + "h " + m + "m";
  if (m > 0) return m + "m " + s + "s";
  return s + "s";
}
function toggleServerLogPoll() {
  var btn = document.getElementById("srvlog-poll-btn");
  if (_srvLogPollInterval) {
    clearInterval(_srvLogPollInterval);
    _srvLogPollInterval = null;
    btn.textContent = "ℹ️ Auto";
    btn.style.background = "";
    showToast("Auto-refresh stopped");
  } else {
    _srvLogPollInterval = setInterval(loadServerLogs, 3000);
    btn.textContent = "G+ Stop";
    btn.style.background = "#fef3c7";
    showToast("Auto-refresh every 3s");
    loadServerLogs();
  }
}

// Maintenance Expiry Polling
var _expiryPollInterval = null;
var _expiryDialogDismissed = false;
function dismissExpiryDialog() {
  _expiryDialogDismissed = true;
  document.getElementById("maint-expiry-modal").classList.remove("open");
  showToast("⚠️ Dismissed  — maintenance still active");
}
function extendMaintenance(hours) {
  if (!_maintData) return;
  var newEnd = new Date(Date.now() + hours * 3600000).toISOString();
  var payload = {
    value: {
      active: true,
      message: _maintData.message || "",
      affectedRoles: _maintData.affectedRoles || [],
      endTime: newEnd,
      startedAt: _maintData.startedAt || new Date().toISOString(),
    },
  };
  apiCall("PUT", "/settings/maintenance", { value: payload })
    .then(function (d) {
      if (d && d.error) {
        showToast("❌ " + d.error);
        return;
      }
      _maintData = d;
      renderMaintUI(d);
      document.getElementById("maint-expiry-modal").classList.remove("open");
      showToast(
        "⏱️ Extended +" +
        hours +
        " hr" +
        (hours > 1 ? "s" : "") +
        "  — ends " +
        fmtDateTime(newEnd),
      );
      logLine(
        "Maintenance EXTENDED +" +
        hours +
        "h  — new end: " +
        fmtDateTime(newEnd),
        "warn",
      );
      loadMaintLogs();
      startExpiryPolling(); // restart for the new end time
    })
    .catch(function (e) {
      showToast("❌ Extend failed: " + e.message);
    });
}
function disableMaintenanceFromExpiry() {
  if (!_maintData) return;
  var payload = {
    value: {
      active: false,
      message: _maintData.message || "",
      affectedRoles: _maintData.affectedRoles || [],
      endTime: null,
      startedAt: null,
    },
  };
  apiCall("PUT", "/settings/maintenance", { value: payload })
    .then(function (d) {
      if (d && d.error) {
        showToast("❌ " + d.error);
        return;
      }
      _maintData = d;
      renderMaintUI(d);
      document.getElementById("maint-expiry-modal").classList.remove("open");
      showToast("✅ Maintenance DISABLED  — System is back online");
      logLine("Maintenance DISABLED after expiry", "success");
      loadMaintLogs();
    })
    .catch(function (e) {
      showToast("ℹ️ " + e.message);
    });
}
// Legacy stubs
function toggleMaintenance() {
  doToggleMaintenance();
}
function saveMaintMsg() {
  saveMaintConfig();
}
function updateMaintLabel() { }
function clearMaintEndTime() {
  document.getElementById("maint-end-time").value = "";
  document.getElementById("maint-end-time").style.borderColor = "#e2e8f0";
}

// Toggle label sync
function syncLabel(checkbox, labelId) {
  var lbl = document.getElementById(labelId);
  lbl.textContent = checkbox.checked ? "ON" : "OFF";
  lbl.className = "toggle-state " + (checkbox.checked ? "on" : "off");
}
// Wire security toggles
["sec-forcepw", "sec-strongpw", "sec-timeout"].forEach(function (id) {
  var el = document.getElementById(id);
  if (el)
    el.addEventListener("change", function () {
      syncLabel(this, id + "-label");
    });
});

// Save settings (writes to MongoDB)
function saveSettings(section) {
  var payload = {};
  if (section === "institution") {
    payload = {
      name: document.getElementById("inst-name").value,
      short: document.getElementById("inst-short").value,
      addr: document.getElementById("inst-addr").value,
      email: document.getElementById("inst-email").value,
      phone: document.getElementById("inst-phone").value,
    };
  } else if (section === "academic") {
    payload = {
      year: document.getElementById("acad-year").value,
      sem: document.getElementById("acad-sem").value,
      start: document.getElementById("acad-start").value,
      end: document.getElementById("acad-end").value,
      minAtt: document.getElementById("acad-minatt").value,
      wdays: document.getElementById("acad-wdays").value,
    };
  } else if (section === "security") {
    payload = {
      forcePw: document.getElementById("sec-forcepw").checked,
      strongPw: document.getElementById("sec-strongpw").checked,
      timeout: document.getElementById("sec-timeout").checked,
      timeoutMin: document.getElementById("sec-timeout-mins").value,
      maxLogin: document.getElementById("sec-maxlogin").value,
    };
  }
  showToast("⏱️ Saving to Database...");
  apiCall("PUT", "/settings/" + section, { value: payload })
    .then(function (d) {
      if (d && d.error) {
        showToast("❌ Save failed: " + d.error);
        return;
      }
      logLine("Settings saved to DB: " + section, "success");
      showToast(
        "ℹ️ " +
        section.charAt(0).toUpperCase() +
        section.slice(1) +
        " settings saved to MongoDB",
      );
    })
    .catch(function (e) {
      showToast("❌ Network error  — settings NOT saved: " + (e.message || ""));
      logLine(
        "Settings save failed: " +
        section +
        "  — " +
        (e.message || "network error"),
        "danger",
      );
    });
}

// Load settings (DB-backed)
function applySettingsToForm(s) {
  var inst = s.institution || {};
  var acad = s.academic || {};
  var sec = s.security || {};
  function val(id, v) {
    var el = document.getElementById(id);
    if (el && v !== undefined && v !== null && v !== "") el.value = v;
  }
  function chk(id, v) {
    var el = document.getElementById(id);
    if (el && v !== undefined) {
      el.checked = !!v;
      syncLabel(el, id + "-label");
    }
  }
  val("inst-name", inst.name);
  val("inst-short", inst.short);
  val("inst-addr", inst.addr);
  val("inst-email", inst.email);
  val("inst-phone", inst.phone);
  val("acad-year", acad.year);
  val("acad-sem", acad.sem);
  val("acad-start", acad.start);
  val("acad-end", acad.end);
  val("acad-minatt", acad.minAtt);
  val("acad-wdays", acad.wdays);
  chk("sec-forcepw", sec.forcePw);
  chk("sec-strongpw", sec.strongPw);
  chk("sec-timeout", sec.timeout);
  val("sec-timeout-mins", sec.timeoutMin);
  val("sec-maxlogin", sec.maxLogin);
}
function showLoadingOverlay(show) {
  var el = document.getElementById("page-loading-overlay");
  if (!el) return;
  if (show) {
    el.classList.remove("hidden");
  } else {
    el.classList.add("hidden");
  }
}
function loadAllSettings() {
  showLoadingOverlay(true);
  // Set placeholder text while loading
  [
    "inst-name",
    "inst-short",
    "inst-addr",
    "inst-email",
    "inst-phone",
    "acad-year",
  ].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.placeholder = "Loading from DB…";
  });
  apiCall("GET", "/settings")
    .then(function (d) {
      if (d && !d.error) {
        applySettingsToForm(d);
        logLine("Settings loaded from MongoDB", "success");
      } else {
        logLine("Settings could not be loaded: " + (d && d.error ? d.error : "unknown error"), "danger");
        showToast("❌ Could not load settings from database");
      }
    })
    .catch(function (e) {
      logLine("Settings load failed: " + (e.message || "network error"), "danger");
      showToast("❌ Could not reach the server to load settings");
    })
    .finally(function () {
      showLoadingOverlay(false);
    });
}

// Admin password reset
function resetAdminPassword() {
  var nw = document.getElementById("admin-pw-new").value.trim();
  var conf = document.getElementById("admin-pw-conf").value.trim();
  if (!nw || !conf) {
    showToast("⚠️ Please fill both fields", "warn");
    return;
  }
  if (nw.length < 6) {
    showToast("⚠️ Password must be at least 6 characters", "warn");
    return;
  }
  if (nw !== conf) {
    showToast("⚠️ Passwords do not match", "warn");
    return;
  }
  apiCall("POST", "/auth/change-password", {
    currentPassword: prompt("Enter your current admin password:"),
    newPassword: nw,
  })
    .then(function (d) {
      if (d.error) {
        showToast("❌ " + d.error, "danger");
        return;
      }
      document.getElementById("admin-pw-new").value = "";
      document.getElementById("admin-pw-conf").value = "";
      logLine("Admin password reset successfully", "success");
      showToast("✅ Admin password updated successfully");
    })
    .catch(function () {
      showToast("❌ Server error", "danger");
    });
}

// Confirm modal
var ACTIONS = {
  teachers: {
    icon: "⚠️",
    title: "Delete All Teachers?",
    body: "This will permanently delete ALL teacher accounts and their subject assignments. Admin account is NOT affected.",
    btn: "Delete Teachers",
    cls: "btn-danger",
  },
  students: {
    icon: "⚠️",
    title: "Delete All Students?",
    body: "This will permanently delete ALL student records, their login accounts, and attendance data.",
    btn: "Delete Students",
    cls: "btn-danger",
  },
  attendance: {
    icon: "⚠️",
    title: "Clear Attendance?",
    body: "This will permanently delete ALL attendance records. Students and teachers are kept.",
    btn: "Clear Attendance",
    cls: "btn-warn",
  },
  logs: {
    icon: "⚠️",
    title: "Clear Activity Logs?",
    body: "This will permanently delete ALL system logs and login history.",
    btn: "Clear Logs",
    cls: "btn-warn",
  },
  clearall: {
    icon: "⚠️",
    title: "Clear Entire Database?",
    body: "This will wipe ALL data: students, teachers, departments, classes, subjects, attendance, notifications, and logs. Your admin account will be preserved. This is IRREVERSIBLE.",
    btn: "Wipe Database",
    cls: "btn-danger",
  },
  resetSettings: {
    icon: "⚠️",
    title: "Reset All Settings?",
    body: "All settings will be restored to factory defaults. Data is NOT affected.",
    btn: "Reset Settings",
    cls: "btn-warn",
  },
};
function openConfirm(action) {
  currentAction = action;
  var cfg = ACTIONS[action] || {};
  document.getElementById("m-icon").textContent = cfg.icon || "⚠️";
  document.getElementById("m-title").textContent = cfg.title || "Are you sure?";
  document.getElementById("m-body").textContent =
    cfg.body || "This cannot be undone.";
  document.getElementById("m-input").value = "";
  document.getElementById("m-progress").style.display = "none";
  var btn = document.getElementById("m-confirm-btn");
  btn.textContent = cfg.btn || "Confirm";
  btn.className = "btn " + (cfg.cls || "btn-danger");
  document.getElementById("confirm-modal").classList.add("open");
}
function closeConfirm() {
  document.getElementById("confirm-modal").classList.remove("open");
  currentAction = null;
}
function executeAction() {
  var input = document.getElementById("m-input").value.trim().toUpperCase();
  if (input !== "CONFIRM") {
    showToast("⚠️ Type CONFIRM to proceed", "warn");
    return;
  }
  document.getElementById("m-confirm-btn").disabled = true;
  showProgress("Processing…", 10);
  if (
    currentAction === "__custom__" &&
    typeof window._customConfirmFn === "function"
  ) {
    window._customConfirmFn();
    return;
  }
  if (currentAction === "resetSettings") {
    var defaults = {
      institution: { name: "", short: "", addr: "", email: "", phone: "" },
      academic: {
        year: "",
        sem: "I",
        start: "",
        end: "",
        minAtt: "75",
        wdays: "6",
      },
      security: {
        forcePw: true,
        strongPw: false,
        timeout: false,
        timeoutMin: "60",
        maxLogin: "5",
      },
    };
    showProgress("Resetting institution settings…", 20);
    apiCall("PUT", "/settings/institution", { value: defaults.institution })
      .then(function () {
        showProgress("Resetting academic settings…", 50);
        return apiCall("PUT", "/settings/academic", { value: defaults.academic });
      })
      .then(function () {
        showProgress("Resetting security settings…", 80);
        return apiCall("PUT", "/settings/security", { value: defaults.security });
      })
      .then(function () {
        applySettingsToForm(defaults);
        closeConfirm();
        logLine("All settings reset to factory defaults in MongoDB", "warn");
        showToast("✅ Settings reset to factory defaults");
      })
      .catch(function (e) {
        closeConfirm();
        showToast("❌ Reset failed: " + (e.message || "network error"));
      });
    return;
  }
  var steps = getDeleteSteps(currentAction);
  runSteps(steps, 0);
}
function getDeleteSteps(action) {
  if (action === "teachers") {
    return [
      {
        label: "Fetching teachers…",
        fn: function () {
          return apiCall("GET", "/teachers");
        },
      },
      {
        label: "Deleting teacher records…",
        fn: function () {
          // DELETE /teachers/:id cascades to remove the shadow user
          // account and that teacher's assignments server-side.
          return apiCall("GET", "/teachers").then(function (teachers) {
            return Promise.all(
              (teachers || []).map(function (t) {
                return apiCall("DELETE", "/teachers/" + t._id);
              }),
            );
          });
        },
      },
    ];
  }
  if (action === "students") {
    return [
      {
        label: "Fetching students…",
        fn: function () {
          return apiCall("GET", "/students");
        },
      },
      {
        label: "Deleting student records…",
        fn: function (prev) {
          return apiCall("GET", "/students").then(function (students) {
            return Promise.all(
              (students || []).map(function (s) {
                return apiCall("DELETE", "/students/" + s._id);
              }),
            );
          });
        },
      },
    ];
  }
  if (action === "attendance") {
    return [
      {
        label: "Fetching attendance records…",
        fn: function () {
          return apiCall("GET", "/attendance");
        },
      },
      {
        label: "Deleting attendance data…",
        fn: function () {
          return apiCall("GET", "/attendance").then(function (records) {
            return Promise.all(
              (records || []).map(function (r) {
                return fetch("/api/attendance/" + r._id, {
                  method: "DELETE",
                  headers: { Authorization: "Bearer " + TOKEN },
                }).then(function (x) {
                  return x.json();
                });
              }),
            );
          });
        },
      },
    ];
  }
  if (action === "logs") {
    return [
      {
        label: "Clearing logs from Database...",
        fn: function () {
          return apiCall("DELETE", "/logs/all");
        },
      },
    ];
  }
  if (action === "clearall") {
    return [
      {
        label: "Removing all students…",
        fn: function () {
          return apiCall("GET", "/students").then(function (s) {
            return Promise.all(
              (s || []).map(function (x) {
                return apiCall("DELETE", "/students/" + x._id);
              }),
            );
          });
        },
      },
      {
        label: "Removing all teachers…",
        fn: function () {
          return apiCall("GET", "/teachers").then(function (t) {
            return Promise.all(
              (t || []).map(function (x) {
                return apiCall("DELETE", "/teachers/" + x._id);
              }),
            );
          });
        },
      },
      {
        label: "Removing all assignments…",
        fn: function () {
          return apiCall("GET", "/assignments").then(function (a) {
            return Promise.all(
              (a || []).map(function (x) {
                return apiCall("DELETE", "/assignments/" + x._id);
              }),
            );
          });
        },
      },
      {
        label: "Removing departments…",
        fn: function () {
          return apiCall("GET", "/depts").then(function (d) {
            return Promise.all(
              (d || []).map(function (x) {
                return apiCall("DELETE", "/depts/" + x._id);
              }),
            );
          });
        },
      },
      {
        label: "Removing classes…",
        fn: function () {
          return apiCall("GET", "/classes").then(function (c) {
            return Promise.all(
              (c || []).map(function (x) {
                return apiCall("DELETE", "/classes/" + x._id);
              }),
            );
          });
        },
      },
      {
        label: "Removing subjects…",
        fn: function () {
          return apiCall("GET", "/subjects").then(function (s) {
            return Promise.all(
              (s || []).map(function (x) {
                return apiCall("DELETE", "/subjects/" + x._id);
              }),
            );
          });
        },
      },
    ];
  }
  return [];
}
function runSteps(steps, idx) {
  // Server-side UndoLog snapshots are saved automatically by delete API endpoints.
  if (idx >= steps.length) {
    showProgress("Done!", 100);
    setTimeout(function () {
      closeConfirm();
      logLine(currentAction + " operation completed  — ", "success");
      showToast("✅ Operation completed successfully");
      loadOverview();
      document.getElementById("m-confirm-btn").disabled = false;
    }, 600);
    return;
  }
  var step = steps[idx];
  var pct = Math.round(((idx + 1) / steps.length) * 90);
  showProgress(step.label, pct);
  logLine(step.label, "info");
  step
    .fn()
    .then(function (result) {
      runSteps(steps, idx + 1);
    })
    .catch(function (err) {
      logLine(
        "Error: " + (err && err.message ? err.message : "Unknown error"),
        "danger",
      );
      showToast("❌ Error during operation. Check logs.", "danger");
      closeConfirm();
      document.getElementById("m-confirm-btn").disabled = false;
    });
}
function showProgress(label, pct) {
  document.getElementById("m-progress").style.display = "block";
  document.getElementById("m-progress-fill").style.width = pct + "%";
  document.getElementById("m-progress-label").textContent = label;
}
// — — Export Data (secure, password-protected)
function refreshExportCount() {
  var tok = sessionStorage.getItem("eams_token") || TOKEN || "";
  fetch("/api/students/count", { headers: { Authorization: "Bearer " + tok } })
    .then(function (r) {
      return r.json();
    })
    .then(function (d) {
      var el = document.getElementById("export-student-count");
      if (el)
        el.textContent =
          (d.count !== undefined ? d.count : "ℹ️ ") + " students";
    })
    .catch(function () { });
}
function exportDataSecure(type) {
  var tok = sessionStorage.getItem("eams_token") || TOKEN || "";
  var resultBox = document.getElementById("export-result-box");
  var detailsEl = document.getElementById("export-result-details");
  var pwEl = document.getElementById("export-password-display");
  if (resultBox) resultBox.style.display = "none";
  showToast("⏱️ Preparing export…");
  fetch("/api/system/export", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + tok,
    },
    body: JSON.stringify({ type: type }),
  })
    .then(function (r) {
      return r.json();
    })
    .then(function (d) {
      if (d.error) {
        showToast("❌ Export failed: " + d.error, "danger");
        return;
      }
      var blob = new Blob([JSON.stringify(d.payload, null, 2)], {
        type: "application/json",
      });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download =
        "eams_export_" +
        type +
        "_" +
        new Date().toISOString().split("T")[0] +
        ".json";
      a.click();
      URL.revokeObjectURL(url);
      if (resultBox) resultBox.style.display = "block";
      if (pwEl) pwEl.textContent = d.exportPassword || "ℹ️ ";
      if (detailsEl)
        detailsEl.textContent =
          "Type: " +
          type +
          "  |  Total students: " +
          d.totalStudents +
          "  |  Exported: " +
          new Date().toLocaleString("en-IN") +
          "  |  Password mailed to admin (wire exportMail() to activate).";
      logLine(
        "Export " + type + " done  — password: " + d.exportPassword,
        "success",
      );
      showToast("✅ Export ready  — check your downloads");
    })
    .catch(function (err) {
      showToast("❌ Export error: " + (err.message || "network"), "danger");
    });
}
// Legacy alias (keep in case anything still calls exportData)
function exportData(type) {
  exportDataSecure(type);
}

// Server utilities
function pingServer() {
  var start = Date.now();
  fetch("/api/dashboard/summary", {
    headers: { Authorization: "Bearer " + TOKEN },
  })
    .then(function (r) {
      var ms = Date.now() - start;
      document.getElementById("ping-result").innerHTML =
        "⚠️ Server responded in <strong>" + ms + "ms</strong>";
      logLine("Ping: " + ms + "ms", "success");
    })
    .catch(function () {
      document.getElementById("ping-result").textContent =
        "⚠️ Server not responding";
      logLine("Ping failed  — server offline?", "danger");
    });
}
function checkDB() {
  apiCall("GET", "/dashboard/summary")
    .then(function (d) {
      if (d.students !== undefined) {
        document.getElementById("ping-result").textContent =
          "⚠️ MongoDB connected  — " +
          d.students +
          " students, " +
          d.teachers +
          " teachers";
        logLine("DB check: Connected  — ", "success");
      } else {
        document.getElementById("ping-result").textContent =
          "⚠️ DB response unexpected";
      }
    })
    .catch(function () {
      document.getElementById("ping-result").textContent =
        "⚠️ DB connection failed";
      logLine("DB check: Failed", "danger");
    });
}
// Toast
// — — Health stats (for Overview live strip)
function loadHealth() {
  var tok = sessionStorage.getItem("eams_token") || TOKEN || "";
  var url =
    _errorsMode === "week"
      ? "/api/system/health?errMode=week"
      : "/api/system/health?errLimit=20";
  fetch(url, {
    headers: { Authorization: "Bearer " + tok },
  })
    .then(function (r) {
      return r.json();
    })
    .then(function (d) {
      var dbDot = document.getElementById("hc-db-dot");
      var dbVal = document.getElementById("hc-db-val");
      if (dbDot)
        dbDot.className = "health-dot " + (d.dbConnected ? "green" : "red");
      if (dbVal) dbVal.textContent = d.dbStatus || "ℹ️ ";
      var up = document.getElementById("hc-uptime");
      if (up) {
        var s = d.serverUptime || 0;
        up.textContent =
          (Math.floor(s / 3600) ? Math.floor(s / 3600) + "h " : "") +
          (Math.floor((s % 3600) / 60)
            ? Math.floor((s % 3600) / 60) + "m "
            : "") +
          (s % 60) +
          "s";
      }
      var errDot = document.getElementById("hc-err-dot");
      var errVal = document.getElementById("hc-err-val");
      if (errDot)
        errDot.className =
          "health-dot " +
          (d.errorCount > 0 ? "red" : d.warnCount > 0 ? "amber" : "green");
      if (errVal)
        errVal.textContent =
          d.errorCount + " errors / " + d.warnCount + " warnings";
      var mem = document.getElementById("hc-mem");
      if (mem) mem.textContent = d.memoryMB + " MB";
      // Recent errors card
      var card = document.getElementById("health-errors-card");
      var list = document.getElementById("health-errors-list");
      if (card && list && d.recentErrors && d.recentErrors.length) {
        var errList = d.recentErrors.slice();
        if (_errorsMode === "week") {
          var weekAgo = Date.now() - 7 * 86400 * 1000;
          var filtered = errList.filter(function (e) {
            return new Date(e.time).getTime() >= weekAgo;
          });
          if (filtered.length) errList = filtered;
        }
        card.style.display = "block";
        list.innerHTML = errList
          .sort(function (a, b) {
            return new Date(b.time) - new Date(a.time);
          })
          .map(function (e) {
            var col =
              e.severity === "critical"
                ? "#dc2626"
                : e.severity === "warning"
                  ? "#d97706"
                  : "#64748b";
            var dt = new Date(e.time);
            var day = dt.toLocaleDateString("en-IN", {
              day: "2-digit",
              month: "short",
              year: "numeric",
            });
            var tim =
              String(dt.getHours()).padStart(2, "0") +
              ":" +
              String(dt.getMinutes()).padStart(2, "0") +
              ":" +
              String(dt.getSeconds()).padStart(2, "0");
            var meta =
              day +
              " " +
              tim +
              (e.userName ? " - " + e.userName : "") +
              (e.ip ? " - " + e.ip : "");
            return `
<div class="error-log" style="--log-color:${col}">
<span class="error-severity">[${e.severity.toUpperCase()}]</span>
<div class="error-content">
<div class="error-title">${e.action} — ${e.details}</div>
<div class="error-meta">${meta}</div>
</div>
<button class="error-delete" onclick="deleteSingleErrorLog('${e._id}', this)" title="Delete">✖</button>
</div>
`;
          })
          .join("");
      } else if (card) {
        card.style.display = "none";
      }
      logLine(
        "Health: DB=" +
        d.dbStatus +
        " Errors=" +
        d.errorCount +
        " Mem=" +
        d.memoryMB +
        "MB",
        "success",
      );
    })
    .catch(function (err) {
      var dbVal = document.getElementById("hc-db-val");
      if (dbVal) dbVal.textContent = "Unreachable";
      var dbDot = document.getElementById("hc-db-dot");
      if (dbDot) dbDot.className = "health-dot red";
      logLine(
        "Health check failed: " + (err.message || "network error"),
        "danger",
      );
    });
}

var _errorsMode = "week";
var _errorsCount = 20; // Default count from settings

function setErrorsMode(mode) {
  _errorsMode = mode;
  var bAll = document.getElementById("err-btn-all");
  var bWeek = document.getElementById("err-btn-week");
  var bN = document.getElementById("err-btn-n");

  if (bAll) {
    bAll.style.background = mode === "all" ? "var(--gD)" : "var(--gLt)";
    bAll.style.color = mode === "all" ? "#fff" : "var(--gD)";
    bAll.style.border = mode === "all" ? "none" : "1px solid var(--gLr)";
  }
  if (bWeek) {
    bWeek.style.background = mode === "week" ? "var(--gD)" : "var(--gLt)";
    bWeek.style.color = mode === "week" ? "#fff" : "var(--gD)";
    bWeek.style.border = mode === "week" ? "none" : "1px solid var(--gLr)";
  }
  if (bN) {
    bN.style.background = mode === "n" ? "var(--gD)" : "var(--gLt)";
    bN.style.color = mode === "n" ? "#fff" : "var(--gD)";
    bN.style.border = mode === "n" ? "none" : "1px solid var(--gLr)";
  }

  // Update description text
  var descEl = document.getElementById("errors-card-desc");
  if (descEl) {
    if (mode === "all") {
      descEl.textContent = "All error-level log entries";
    } else if (mode === "week") {
      descEl.textContent = "Error logs from the past 7 days";
    } else {
      descEl.textContent = "Last " + _errorsCount + " error-level log entries";
    }
  }

  loadHealth();
}

function deleteSingleErrorLog(id, btn) {
  if (!id) return;
  var row = btn ? btn.closest(".error-log") : null;
  if (row) row.style.opacity = "0.4";
  apiCall("DELETE", "/logs/" + id)
    .then(function () {
      if (row) row.remove();
      showToast("Log entry deleted");
      loadHealth();
    })
    .catch(function (err) {
      if (row) row.style.opacity = "1";
      showToast("Delete failed: " + (err.message || "error"));
    });
}
// — — Clear all error/warning logs (from overview card)
function clearErrorLogs() {
  openConfirmEx({
    icon: "🛠️",
    title: "Clear All Error Logs?",
    body: "This will permanently delete all warning, error, and critical log entries. System and info logs are preserved.",
    btn: "Clear Logs",
    cls: "btn-danger",
    onConfirm: function () {
      showProgress("Fetching error log IDs…", 20);
      // Fetch all warning/critical/error logs then delete each by ID
      apiCall("GET", "/logs?severity=warning&limit=100")
        .then(function (warnRes) {
          return apiCall("GET", "/logs?severity=critical&limit=100").then(
            function (critRes) {
              return apiCall("GET", "/logs?severity=error&limit=100").then(
                function (errRes) {
                  var all = ((warnRes && warnRes.logs) || [])
                    .concat((critRes && critRes.logs) || [])
                    .concat((errRes && errRes.logs) || []);
                  showProgress("Deleting " + all.length + " log entries…", 40);
                  return Promise.all(
                    all.map(function (l) {
                      return apiCall("DELETE", "/logs/" + l._id);
                    }),
                  );
                },
              );
            },
          );
        })
        .then(function () {
          closeConfirm();
          logLine("All error/warning logs cleared", "warn");
          showToast("⚠️ Error logs cleared");
          loadHealth();
        })
        .catch(function (e) {
          closeConfirm();
          showToast("❌ Clear failed: " + (e.message || "network"));
        });
    },
  });
}
function deleteSingleErrorLog(id, btn) {
  if (btn) btn.disabled = true;
  apiCall("DELETE", "/logs/" + id)
    .then(function (d) {
      if (d && d.deleted) {
        showToast("⚠️ Log entry deleted");
        loadHealth();
      } else {
        showToast("❌ Delete failed");
        if (btn) btn.disabled = false;
      }
    })
    .catch(function () {
      showToast("❌ Delete failed");
      if (btn) btn.disabled = false;
    });
}
// Extended confirm — supports custom onConfirm callback
function openConfirmEx(cfg) {
  currentAction = "__custom__";
  window._customConfirmFn = cfg.onConfirm;
  document.getElementById("m-icon").textContent = cfg.icon || "⚠️";
  document.getElementById("m-title").textContent = cfg.title || "Are you sure?";
  document.getElementById("m-body").textContent =
    cfg.body || "This cannot be undone.";
  document.getElementById("m-input").value = "";
  document.getElementById("m-progress").style.display = "none";
  var btn = document.getElementById("m-confirm-btn");
  btn.textContent = cfg.btn || "Confirm";
  btn.className = "btn " + (cfg.cls || "btn-danger");
  btn.disabled = false;
  document.getElementById("confirm-modal").classList.add("open");
}

// Backup page
function loadBackupPage() {
  var tok = sessionStorage.getItem("eams_token") || TOKEN || "";
  fetch("/api/system/backup/history", {
    headers: { Authorization: "Bearer " + tok },
  })
    .then(function (r) {
      return r.json();
    })
    .then(function (logs) {
      var list = document.getElementById("bk-history-list");
      if (!list) return;
      if (!logs.length) {
        list.innerHTML =
          '<div style="color:var(--tmu);font-size:13px;text-align:center;padding:20px 0;">No backup history yet.</div>';
        return;
      }
      var last = logs[0];
      var ld = document.getElementById("bk-last-date");
      if (ld) ld.textContent = new Date(last.time).toLocaleDateString("en-IN");
      var lb = document.getElementById("bk-last-by");
      if (lb) lb.textContent = last.userName || "ℹ️ ";
      var ldocs = document.getElementById("bk-last-docs");
      if (ldocs)
        ldocs.textContent = (last.details || "ℹ️ ").split(" docs")[0] || "ℹ️ ";
      list.innerHTML = logs
        .map(function (l) {
          return (
            '<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;background:#f8fafc;border-radius:10px;border:1px solid #e2e8f0;">' +
            '<div><div style="font-weight:600;font-size:13px;color:var(--td);">⚠️ ' +
            (l.details || "Full backup") +
            "</div>" +
            '<div style="font-size:11px;color:var(--tmu);">' +
            new Date(l.time).toLocaleString("en-IN") +
            " - " +
            l.userName +
            "</div></div>" +
            '<span style="font-size:11px;font-weight:600;color:#16a34a;"> — Completed</span></div>'
          );
        })
        .join("");
    })
    .catch(function () {
      var list = document.getElementById("bk-history-list");
      if (list)
        list.innerHTML =
          '<div style="color:#dc2626;font-size:13px;text-align:center;padding:20px 0;">Failed to load history.</div>';
    });
}
function createBackup() {
  var tok = sessionStorage.getItem("eams_token") || TOKEN || "";
  var btn = document.getElementById("bk-create-btn");
  var progWrap = document.getElementById("bk-progress-wrap");
  var progFill = document.getElementById("bk-progress-fill");
  var progLabel = document.getElementById("bk-progress-label");
  var resultBox = document.getElementById("bk-result-box");
  var resultDet = document.getElementById("bk-result-details");
  var pwEl = document.getElementById("bk-password-display");
  if (btn) btn.disabled = true;
  if (resultBox) resultBox.style.display = "none";
  if (progWrap) progWrap.style.display = "block";
  var pct = 0;
  var stages = [
    "Connecting to database…",
    "Fetching students…",
    "Fetching teachers…",
    "Fetching departments & classes…",
    "Fetching attendance records…",
    "Compressing payload…",
    "Uploading to Google Drive (stub)…",
    "Mailing password (stub)…",
  ];
  var fakeTimer = setInterval(function () {
    pct = Math.min(pct + 4, 85);
    if (progFill) progFill.style.width = pct + "%";
    if (progLabel)
      progLabel.textContent =
        stages[Math.min(Math.floor(pct / 12), stages.length - 1)];
  }, 400);
  fetch("/api/system/backup", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + tok,
    },
  })
    .then(function (r) {
      return r.json();
    })
    .then(function (d) {
      clearInterval(fakeTimer);
      if (progFill) progFill.style.width = "100%";
      if (d.error) {
        if (progLabel) progLabel.textContent = "Error: " + d.error;
        showToast("❌ Backup failed: " + d.error, "danger");
        if (btn) btn.disabled = false;
        return;
      }
      setTimeout(function () {
        if (progWrap) progWrap.style.display = "none";
        if (resultBox) resultBox.style.display = "block";
        if (pwEl) pwEl.textContent = d.backupPassword || "ℹ️ ";
        var cols = d.collections || {};
        if (resultDet)
          resultDet.innerHTML =
            "Total docs: <strong>" +
            d.totalDocs +
            "</strong>" +
            " | Students: " +
            cols.students +
            " | Teachers: " +
            cols.teachers +
            " | Departments: " +
            cols.departments +
            " | Classes: " +
            cols.classes +
            "<br><em>GDrive upload: wire uploadToGDrive() - Password mail: wire sendMail() to activate</em>";
        logLine(
          "Backup created  — " +
          d.totalDocs +
          " docs | pw: " +
          d.backupPassword,
          "success",
        );
        showToast("✅ Backup created  — " + d.totalDocs + " docs");
        loadBackupPage();
      }, 500);
      if (btn) btn.disabled = false;
    })
    .catch(function (err) {
      clearInterval(fakeTimer);
      if (progLabel) progLabel.textContent = "Backup failed  — check server";
      showToast("❌ Backup error: " + (err.message || "network"), "danger");
      if (btn) btn.disabled = false;
    });
}

// Undo page
var _undoData = [];
var _undoFilter = "all";
function loadUndoPage() {
  var tok = sessionStorage.getItem("eams_token") || TOKEN || "";
  var list = document.getElementById("undo-list");
  if (list)
    list.innerHTML =
      '<div style="color:var(--tmu);font-size:13px;text-align:center;padding:30px 0;">Loading…</div>';
  fetch("/api/undo", { headers: { Authorization: "Bearer " + tok } })
    .then(function (r) {
      return r.json();
    })
    .then(function (data) {
      _undoData = data || [];
      renderUndoList();
    })
    .catch(function () {
      if (list)
        list.innerHTML =
          '<div style="color:#dc2626;font-size:13px;text-align:center;padding:20px 0;">Failed to load undo entries.</div>';
    });
}
function filterUndo(col, btn) {
  _undoFilter = col;
  document.querySelectorAll(".undo-filter-btn").forEach(function (b) {
    b.classList.remove("act");
  });
  if (btn) btn.classList.add("act");
  renderUndoList();
}
function renderUndoList() {
  var list = document.getElementById("undo-list");
  if (!list) return;
  var items =
    _undoFilter === "all"
      ? _undoData
      : _undoData.filter(function (x) {
        return x.collectionName === _undoFilter;
      });
  if (!items.length) {
    list.innerHTML =
      '<div style="color:var(--tmu);font-size:13px;text-align:center;padding:30px 0;">No restorable deletions' +
      (_undoFilter !== "all" ? " for " + _undoFilter : "") +
      ".</div>";
    return;
  }
  var colIcons = {
    departments: "🧑‍🏫",
    classes: "🎓",
    subjects: "🛠️",
    students: "🎓",
    teachers: "🧑‍🏫",
  };
  var now = Date.now();
  list.innerHTML = items
    .map(function (e) {
      var daysLeft = Math.ceil(
        (new Date(e.expiresAt).getTime() - now) / 86400000,
      );
      var urgency =
        daysLeft <= 2 ? "#dc2626" : daysLeft <= 5 ? "#d97706" : "#16a34a";
      return (
        '<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;background:#fff;border-radius:10px;border:1.5px solid #e2e8f0;">' +
        '<div style="display:flex;align-items:center;gap:10px;">' +
        '<span style="font-size:20px;">' +
        (colIcons[e.collectionName] || "🛠️") +
        "</span>" +
        '<div><div style="font-weight:600;font-size:13px;color:var(--td);">' +
        e.label +
        "</div>" +
        '<div style="font-size:11px;color:var(--tmu);">' +
        e.collectionName +
        " - deleted by " +
        (e.deletedBy || "admin") +
        " - " +
        new Date(e.createdAt).toLocaleString("en-IN") +
        "</div></div></div>" +
        '<div style="display:flex;align-items:center;gap:8px;">' +
        '<span style="font-size:11px;font-weight:700;color:' +
        urgency +
        ';">' +
        daysLeft +
        "d left</span>" +
        "<button onclick=\"doUndo('" +
        e._id +
        '\', this)" class="btn btn-pri btn-sm">✅ Restore</button>' +
        "<button onclick=\"dismissUndo('" +
        e._id +
        '\', this)" class="btn btn-out btn-sm" style="color:#dc2626;border-color:#fca5a5;">✖</button>' +
        "</div></div>"
      );
    })
    .join("");
}
function doUndo(id, btn) {
  openConfirmEx({
    icon: "✅",
    title: "Restore Record?",
    body: "This will re-insert the deleted record back into the database with a fresh ID. All fields will be restored.",
    btn: "✅ Restore",
    cls: "btn-pri",
    onConfirm: function () {
      if (btn) btn.disabled = true;
      showProgress("Restoring record…", 30);
      var tok = sessionStorage.getItem("eams_token") || TOKEN || "";
      fetch("/api/undo/" + id, {
        method: "POST",
        headers: { Authorization: "Bearer " + tok },
      })
        .then(function (r) {
          return r.json();
        })
        .then(function (d) {
          showProgress("Done!", 100);
          setTimeout(function () {
            closeConfirm();
            if (d.error) {
              showToast("❌ Restore failed: " + d.error);
              if (btn) btn.disabled = false;
              return;
            }
            showToast("✅ Restored: " + d.label);
            logLine("Undo restore: " + d.label, "success");
            loadUndoPage();
          }, 400);
        })
        .catch(function (err) {
          closeConfirm();
          showToast("❌ Error: " + (err.message || "network"));
          if (btn) btn.disabled = false;
        });
    },
  });
}
function dismissUndo(id, btn) {
  openConfirmEx({
    icon: "🛠️",
    title: "Discard Undo Entry?",
    body: "This will permanently delete the undo entry. The record cannot be recovered once discarded.",
    btn: "⚠️ Discard",
    cls: "btn-danger",
    onConfirm: function () {
      showProgress("Discarding entry…", 50);
      var tok = sessionStorage.getItem("eams_token") || TOKEN || "";
      fetch("/api/undo/" + id, {
        method: "DELETE",
        headers: { Authorization: "Bearer " + tok },
      })
        .then(function () {
          showProgress("Done!", 100);
          setTimeout(function () {
            closeConfirm();
            showToast("⚠️ Undo entry discarded");
            loadUndoPage();
          }, 400);
        })
        .catch(function () {
          closeConfirm();
          showToast("❌ Failed to discard");
        });
    },
  });
}
// — — Legacy saveBackup stub (runSteps calls this — no-op now)
function saveBackup(label, data) {
  /* superseded by server-side UndoLog */
}
function loadBackups() {
  /* legacy no-op */
}

// User Grid & Identity Console Controller
var _ugState = {
  role: "student",
  page: 1,
  limit: 50,
  search: "",
  dept: "",
  class: "",
  status: "",
  date: "",
  sortBy: "name",
  sortDir: "asc",
  selectedIds: new Set(),
  data: [],
  total: 0,
  pages: 1,
  stats: { total: 0, active: 0, inactive: 0, locked: 0 },
  departments: [],
  classes: [],
  yearConfigs: [],
  searchTimer: null,
  isInitialized: false,
};

function ugInit() {
  if (!_ugState.isInitialized) {
    _ugState.isInitialized = true;
    ugLoadFilterOptions();
  }
  ugLoadData();
}

function ugLoadFilterOptions() {
  var tok = getToken();
  var h = { Authorization: "Bearer " + tok };

  // Load Academic Years directly from yearconfig (/api/year)
  fetch("/api/year", { headers: h })
    .then(function (r) { return r.json(); })
    .then(function (years) {
      var yrEl = document.getElementById("ug-e-stu-year");
      if (Array.isArray(years) && years.length > 0) {
        _ugState.yearConfigs = years;
        if (yrEl) {
          var opts = '<option value="">— Select Academic Year —</option>' +
            years.map(function (y) {
              var isCur = y.isCurrent ? " (Current)" : "";
              return '<option value="' + escapeHtml(y.academicYear) + '"' + (y.isCurrent ? ' selected' : '') + '>' + escapeHtml(y.academicYear + isCur) + '</option>';
            }).join("");
          yrEl.innerHTML = opts;
          var cur = years.find(function (y) { return y.isCurrent; });
          if (cur) {
            populateUGBatches(cur.academicYear);
          }
        }
      } else {
        // Fallback generator
        var currentYear = new Date().getFullYear();
        if (yrEl) {
          var yrHtml = '<option value="">— Select Academic Year —</option>';
          for (var y = currentYear + 1; y >= currentYear - 6; y--) {
            var acStr = y + "-" + (y + 1);
            yrHtml += '<option value="' + acStr + '">' + acStr + '</option>';
          }
          yrEl.innerHTML = yrHtml;
        }
      }
    })
    .catch(function () {
      var currentYear = new Date().getFullYear();
      var yrEl = document.getElementById("ug-e-stu-year");
      if (yrEl) {
        var yrHtml = '<option value="">— Select Academic Year —</option>';
        for (var y = currentYear + 1; y >= currentYear - 6; y--) {
          var acStr = y + "-" + (y + 1);
          yrHtml += '<option value="' + acStr + '">' + acStr + '</option>';
        }
        yrEl.innerHTML = yrHtml;
      }
    });

  // Load departments for filter and modal dropdowns (supports both /api/depts and /api/departments)
  fetch("/api/depts", { headers: h })
    .then(function (r) {
      if (!r.ok) return fetch("/api/departments", { headers: h }).then(function (res) { return res.json(); });
      return r.json();
    })
    .then(function (depts) {
      if (Array.isArray(depts)) {
        _ugState.departments = depts;
        var deptFilter = document.getElementById("ug-dept-filter");
        var stuDeptModal = document.getElementById("ug-e-stu-dept");
        var tchDeptModal = document.getElementById("ug-e-tch-dept");
        var admDeptModal = document.getElementById("ug-e-adm-dept");

        var filterOpts = '<option value="">All Departments</option>' +
          depts.map(function (d) {
            var val = d.code || d.name;
            var label = (d.code ? d.code + ' - ' : '') + d.name;
            return '<option value="' + escapeHtml(val) + '">' + escapeHtml(label) + '</option>';
          }).join("");

        var modalOpts = '<option value="">— Select Department —</option>' +
          depts.map(function (d) {
            var val = d.code || d.name;
            var label = (d.code ? d.code + ' - ' : '') + d.name;
            return '<option value="' + escapeHtml(val) + '" data-id="' + (d._id || '') + '" data-code="' + (d.code || '') + '">' + escapeHtml(label) + '</option>';
          }).join("");

        if (deptFilter) deptFilter.innerHTML = filterOpts;
        if (stuDeptModal) stuDeptModal.innerHTML = modalOpts;
        if (tchDeptModal) tchDeptModal.innerHTML = modalOpts;
        if (admDeptModal) admDeptModal.innerHTML = modalOpts;
      }
    })
    .catch(function () { });

  // Load classes for filter and modal dropdowns
  fetch("/api/classes", { headers: h })
    .then(function (r) { return r.json(); })
    .then(function (classes) {
      if (Array.isArray(classes)) {
        _ugState.classes = classes;
        var classFilter = document.getElementById("ug-class-filter");

        var filterOpts = '<option value="">All Classes</option>' +
          classes.map(function (c) {
            var val = c.classTrackId || c.name || c._id;
            var label = c.name || c.classTrackId;
            return '<option value="' + escapeHtml(val) + '">' + escapeHtml(label) + '</option>';
          }).join("");

        if (classFilter) classFilter.innerHTML = filterOpts;
        updateUGStuClassList();
      }
    })
    .catch(function () { });
}

function populateUGBatches(acYear, selectedBatch) {
  var batchEl = document.getElementById("ug-e-stu-batch");
  if (!batchEl) return;

  var yearConfigs = _ugState.yearConfigs || [];
  var matchedYear = yearConfigs.find(function (y) { return y.academicYear === acYear; });

  var batchList = [];
  if (matchedYear && Array.isArray(matchedYear.batches) && matchedYear.batches.length > 0) {
    batchList = matchedYear.batches.map(function (b) { return b.batch || b.batchTrackId; });
  }

  var startYear = parseInt((acYear || "").split("-")[0], 10) || new Date().getFullYear();
  if (batchList.length === 0) {
    batchList = [
      startYear + "-" + (startYear + 4),
      startYear + "-" + (startYear + 2),
      startYear + "-" + (startYear + 3),
      startYear + "-" + (startYear + 5)
    ];
  }

  var opts = '<option value="">— Select Batch —</option>';
  batchList.forEach(function (b) {
    var isSel = (b === selectedBatch);
    opts += '<option value="' + escapeHtml(b) + '" ' + (isSel ? 'selected' : '') + '>' + escapeHtml(b) + '</option>';
  });
  if (selectedBatch && !batchList.includes(selectedBatch)) {
    opts += '<option value="' + escapeHtml(selectedBatch) + '" selected>' + escapeHtml(selectedBatch) + '</option>';
  }
  batchEl.innerHTML = opts;
}

function onUGStuYearChange() {
  var yrEl = document.getElementById("ug-e-stu-year");
  var val = yrEl ? yrEl.value : "";
  populateUGBatches(val);
  updateUGStuClassList();
}

function onUGStuBatchChange() {
  updateUGStuClassList();
}

function onUGStuDeptChange() {
  var deptSelect = document.getElementById("ug-e-stu-dept");
  var val = deptSelect ? deptSelect.value : "";
  var depts = _ugState.departments || [];
  var dept = depts.find(function (d) {
    return d.code === val || d.name === val || d._id === val || (d.code && d.code.toLowerCase() === val.toLowerCase());
  });

  var ctEl = document.getElementById("ug-e-stu-course-type");
  var brEl = document.getElementById("ug-e-stu-branch");
  var dIdEl = document.getElementById("ug-e-deptid");
  var dCodeEl = document.getElementById("ug-e-deptcode");

  if (dept) {
    if (ctEl) ctEl.value = dept.courseType || "UG";
    if (brEl) brEl.value = dept.branch || dept.code || "";
    if (dIdEl) dIdEl.value = dept._id || "";
    if (dCodeEl) dCodeEl.value = dept.code || "";
  } else {
    if (ctEl) ctEl.value = "UG";
    if (brEl) brEl.value = "";
    if (dIdEl) dIdEl.value = "";
    if (dCodeEl) dCodeEl.value = "";
  }
  updateUGStuClassList();
}

function onUGStuClassChange() {
  var classSelect = document.getElementById("ug-e-stu-class");
  if (!classSelect) return;
  var classVal = classSelect.value;
  var classes = _ugState.classes || [];
  var cls = classes.find(function (c) {
    return c._id === classVal || c.classTrackId === classVal || c.name === classVal;
  });

  var secEl = document.getElementById("ug-e-stu-section");
  var cIdEl = document.getElementById("ug-e-classid");

  if (cls) {
    if (cIdEl) cIdEl.value = cls._id || "";
    if (secEl) {
      if (cls.section) {
        secEl.value = cls.section;
      } else {
        var m = cls.name ? cls.name.match(/-([A-Z])$/i) : null;
        secEl.value = m ? m[1].toUpperCase() : "A";
      }
    }
  }
}

function onUGStuRegNoChange() {
  var regInput = document.getElementById("ug-e-stu-regno");
  if (!regInput) return;
  var regNo = regInput.value.replace(/\D/g, "");
  regInput.value = regNo;
  if (regNo.length < 12) return;

  var yr = regNo.substring(4, 6);
  var deptNum = regNo.substring(6, 9);
  var acYear = '20' + yr + '-' + (parseInt(yr, 10) + 1);
  var batch = '20' + yr + '-' + (parseInt(yr, 10) + 4);

  var yrEl = document.getElementById("ug-e-stu-year");
  if (yrEl) {
    yrEl.value = acYear;
    populateUGBatches(acYear, batch);
  }

  var depts = _ugState.departments || [];
  var dept = depts.find(function (d) {
    return (d.deptNumber && String(d.deptNumber) === deptNum) ||
      (d.code && d.code.endsWith(deptNum)) ||
      (d.deptCode && d.deptCode.endsWith(deptNum));
  });

  if (dept) {
    var deptEl = document.getElementById("ug-e-stu-dept");
    if (deptEl) {
      deptEl.value = dept.code || dept.name;
      onUGStuDeptChange();
    }
  } else {
    updateUGStuClassList();
  }
}

function updateUGStuClassList(preserveClassVal) {
  var stuClassModal = document.getElementById("ug-e-stu-class");
  if (!stuClassModal) return;

  var deptVal = document.getElementById("ug-e-stu-dept") ? document.getElementById("ug-e-stu-dept").value : "";
  var batchVal = document.getElementById("ug-e-stu-batch") ? document.getElementById("ug-e-stu-batch").value : "";
  var classes = _ugState.classes || [];

  var filtered = classes.filter(function (c) {
    var matchDept = !deptVal || (c.department && c.department.toLowerCase() === deptVal.toLowerCase()) ||
      (c.deptCode && c.deptCode.toLowerCase() === deptVal.toLowerCase()) ||
      (c.deptId && String(c.deptId) === deptVal);
    var matchBatch = !batchVal || (c.batch && String(c.batch).trim() === batchVal.trim()) ||
      (c.batchTrackId && String(c.batchTrackId).trim() === batchVal.trim());
    return matchDept && matchBatch;
  });

  if (filtered.length === 0 && (deptVal || batchVal)) {
    filtered = classes.filter(function (c) {
      return !deptVal || (c.department && c.department.toLowerCase() === deptVal.toLowerCase()) ||
        (c.deptCode && c.deptCode.toLowerCase() === deptVal.toLowerCase()) ||
        (c.deptId && String(c.deptId) === deptVal);
    });
  }
  if (filtered.length === 0) filtered = classes;

  var opts = '<option value="">— Select Class —</option>' +
    filtered.map(function (c) {
      var val = c.classTrackId || c.name || c._id;
      var label = (c.name || c.classTrackId) + (c.section ? ' (' + c.section + ')' : '');
      var isSel = preserveClassVal && (preserveClassVal === val || preserveClassVal === c.name || preserveClassVal === c._id || preserveClassVal === c.classTrackId);
      return '<option value="' + escapeHtml(val) + '" data-id="' + (c._id || '') + '" ' + (isSel ? 'selected' : '') + '>' + escapeHtml(label) + '</option>';
    }).join("");

  stuClassModal.innerHTML = opts;

  if (preserveClassVal) {
    var matched = filtered.find(function (c) {
      return preserveClassVal === c.classTrackId || preserveClassVal === c.name || preserveClassVal === c._id;
    });
    if (matched) {
      stuClassModal.value = matched.classTrackId || matched.name || matched._id;
    }
  }

  onUGStuClassChange();
}

function ugToggleAdminPrivs(checked) {
  var wrap = document.getElementById("ug-tch-privs-wrap");
  if (wrap) {
    wrap.style.display = checked ? "flex" : "none";
  }
}

function ugSetRole(role, btn) {
  _ugState.role = role;
  _ugState.page = 1;
  _ugState.selectedIds.clear();
  ugUpdateBulkBar();

  document.querySelectorAll(".ug-tab").forEach(function (b) {
    b.classList.remove("act");
  });
  if (btn) {
    btn.classList.add("act");
  } else {
    var defaultBtn = document.getElementById("ugt-" + role);
    if (defaultBtn) defaultBtn.classList.add("act");
  }

  var clsFilter = document.getElementById("ug-class-filter");
  var dateFilter = document.getElementById("ug-date-filter");
  var deptFilter = document.getElementById("ug-dept-filter");
  var statusFilter = document.getElementById("ug-status-filter");

  if (clsFilter) clsFilter.style.display = (role === "student" || role === "attendance") ? "" : "none";
  if (dateFilter) dateFilter.style.display = (role === "attendance") ? "" : "none";
  if (deptFilter) deptFilter.style.display = (role !== "admin") ? "" : "none";
  if (statusFilter) statusFilter.style.display = (role !== "attendance") ? "" : "none";

  ugLoadData();
}

function ugOnFilterChange() {
  _ugState.page = 1;
  _ugState.dept = document.getElementById("ug-dept-filter") ? document.getElementById("ug-dept-filter").value : "";
  _ugState.class = document.getElementById("ug-class-filter") ? document.getElementById("ug-class-filter").value : "";
  _ugState.status = document.getElementById("ug-status-filter") ? document.getElementById("ug-status-filter").value : "";
  _ugState.date = document.getElementById("ug-date-filter") ? document.getElementById("ug-date-filter").value : "";
  ugLoadData();
}

function ugDebouncedSearch() {
  clearTimeout(_ugState.searchTimer);
  _ugState.searchTimer = setTimeout(function () {
    var searchEl = document.getElementById("ug-search");
    _ugState.search = searchEl ? searchEl.value.trim() : "";
    _ugState.page = 1;
    ugLoadData();
  }, 300);
}

function ugOnLimitChange() {
  var limitEl = document.getElementById("ug-limit-select");
  var val = limitEl ? limitEl.value : "50";
  _ugState.limit = (val === "all") ? 0 : parseInt(val, 10);
  _ugState.page = 1;
  ugLoadData();
}

function ugSortBy(col) {
  if (_ugState.sortBy === col) {
    _ugState.sortDir = _ugState.sortDir === "asc" ? "desc" : "asc";
  } else {
    _ugState.sortBy = col;
    _ugState.sortDir = "asc";
  }
  ugLoadData();
}

function ugChangePage(delta) {
  var newPage = _ugState.page + delta;
  if (newPage >= 1 && newPage <= _ugState.pages) {
    _ugState.page = newPage;
    ugLoadData();
  }
}

function ugGoToPage(p) {
  if (p >= 1 && p <= _ugState.pages) {
    _ugState.page = p;
    ugLoadData();
  }
}

function ugRefresh() {
  ugLoadData();
  showToast("Refreshing User Grid data…", "info");
}

function ugLoadData() {
  var tok = getToken();
  var loadingEl = document.getElementById("ug-loading");
  var emptyEl = document.getElementById("ug-empty");

  if (loadingEl) loadingEl.style.display = "block";
  if (emptyEl) emptyEl.style.display = "none";

  var role = _ugState.role;
  var url = "";

  if (role === "attendance") {
    var params = [];
    if (_ugState.date) params.push("date=" + encodeURIComponent(_ugState.date));
    if (_ugState.class) params.push("classId=" + encodeURIComponent(_ugState.class));
    if (_ugState.search) params.push("search=" + encodeURIComponent(_ugState.search));
    params.push("page=" + _ugState.page);
    params.push("limit=" + _ugState.limit);
    url = "/api/attendance" + (params.length ? "?" + params.join("&") : "");
  } else {
    var uParams = [];
    uParams.push("role=" + encodeURIComponent(role));
    if (_ugState.dept) uParams.push("department=" + encodeURIComponent(_ugState.dept));
    if (_ugState.class && role === "student") uParams.push("class=" + encodeURIComponent(_ugState.class));
    if (_ugState.status) uParams.push("status=" + encodeURIComponent(_ugState.status));
    if (_ugState.search) uParams.push("search=" + encodeURIComponent(_ugState.search));
    uParams.push("page=" + _ugState.page);
    uParams.push("limit=" + _ugState.limit);
    uParams.push("sortBy=" + encodeURIComponent(_ugState.sortBy));
    uParams.push("sortDir=" + encodeURIComponent(_ugState.sortDir));
    url = "/api/users?" + uParams.join("&");
  }

  fetch(url, { headers: { Authorization: "Bearer " + tok } })
    .then(function (r) {
      if (!r.ok) throw new Error("HTTP error " + r.status);
      return r.json();
    })
    .then(function (res) {
      if (loadingEl) loadingEl.style.display = "none";

      if (role === "attendance") {
        var records = Array.isArray(res) ? res : (res.records || []);
        _ugState.data = records;
        _ugState.total = records.length;
        _ugState.pages = 1;
        _ugState.stats = {
          total: records.length,
          active: records.filter(function (r) { return r.status === "present"; }).length,
          inactive: records.filter(function (r) { return r.status === "absent"; }).length,
          locked: records.filter(function (r) { return r.status === "od" || r.status === "leave"; }).length,
        };
      } else {
        _ugState.data = res.users || [];
        _ugState.total = res.total || 0;
        _ugState.pages = res.pages || 1;
        _ugState.stats = res.stats || { total: _ugState.total, active: 0, inactive: 0, locked: 0 };
      }

      ugUpdateStats();
      renderUGTable();
      ugUpdatePagination();
    })
    .catch(function (err) {
      if (loadingEl) loadingEl.style.display = "none";
      showToast("Error loading " + role + " data: " + (err.message || ""), "danger");
    });
}

function ugUpdateStats() {
  var s = _ugState.stats;
  var role = _ugState.role;
  var tEl = document.getElementById("ugs-total");
  var aEl = document.getElementById("ugs-active");
  var iEl = document.getElementById("ugs-inactive");
  var lEl = document.getElementById("ugs-locked");

  if (tEl) tEl.textContent = s.total;
  if (aEl) aEl.textContent = s.active;
  if (iEl) iEl.textContent = s.inactive;
  if (lEl) lEl.textContent = s.locked;

  var aCardLbl = document.querySelector(".ug-stat-card.active-card .ug-stat-lbl");
  var iCardLbl = document.querySelector(".ug-stat-card.inactive-card .ug-stat-lbl");
  var lCardLbl = document.querySelector(".ug-stat-card.locked-card .ug-stat-lbl");

  if (role === "attendance") {
    if (aCardLbl) aCardLbl.textContent = "Present Records";
    if (iCardLbl) iCardLbl.textContent = "Absent Records";
    if (lCardLbl) lCardLbl.textContent = "OD / Approved Leave";
  } else {
    if (aCardLbl) aCardLbl.textContent = "Active Accounts";
    if (iCardLbl) iCardLbl.textContent = "Inactive";
    if (lCardLbl) lCardLbl.textContent = "Locked (Brute-Force)";
  }
}

function ugSortIndicator(col) {
  if (_ugState.sortBy === col) {
    return _ugState.sortDir === "asc" ? ' <span style="font-size:11px;color:var(--gD);font-weight:800;">▲</span>' : ' <span style="font-size:11px;color:var(--gD);font-weight:800;">▼</span>';
  }
  return ' <span style="font-size:10px;color:var(--tdi);opacity:0.35;">↕</span>';
}

function renderUGTable() {
  var thead = document.getElementById("ug-thead");
  var tbody = document.getElementById("ug-tbody");
  var empty = document.getElementById("ug-empty");
  var data = _ugState.data;
  var role = _ugState.role;

  if (!thead || !tbody) return;

  if (!data || data.length === 0) {
    thead.innerHTML = "";
    tbody.innerHTML = "";
    if (empty) empty.style.display = "block";
    return;
  }
  if (empty) empty.style.display = "none";

  var allSelected = data.length > 0 && data.every(function (r) { return _ugState.selectedIds.has(r._id); });
  var selectAllTh = '<th style="width:36px;text-align:center;"><input type="checkbox" onchange="ugToggleSelectAll(this)" ' + (allSelected ? 'checked' : '') + '></th>';

  if (role === "attendance") {
    thead.innerHTML = '<tr>' +
      selectAllTh +
      '<th class="sortable" onclick="ugSortBy(\'studentName\')">Student Name' + ugSortIndicator('studentName') + '</th>' +
      '<th class="sortable" onclick="ugSortBy(\'date\')">Date / Period' + ugSortIndicator('date') + '</th>' +
      '<th>Class &amp; Dept</th>' +
      '<th>Subject</th>' +
      '<th class="sortable" onclick="ugSortBy(\'status\')">Status' + ugSortIndicator('status') + '</th>' +
      '<th>Remarks</th>' +
      '<th style="width:170px;text-align:center;">Actions</th>' +
      '</tr>';

    tbody.innerHTML = data.map(function (rec) {
      var isChecked = _ugState.selectedIds.has(rec._id);
      var badgeCls = (rec.status === "present") ? "badge-active" : ((rec.status === "absent") ? "badge-locked" : "badge-inactive");
      var statusLbl = (rec.status === "present") ? "🟢 Present" : ((rec.status === "absent") ? "🔴 Absent" : ((rec.status === "od") ? "🟡 On Duty" : "🟣 Leave"));

      return '<tr class="' + (isChecked ? 'ug-row-selected' : '') + '">' +
        '<td style="text-align:center;"><input type="checkbox" onchange="ugToggleRowSelect(\'' + rec._id + '\')" ' + (isChecked ? 'checked' : '') + '></td>' +
        '<td><div style="font-weight:700;color:var(--td);">' + escapeHtml(rec.studentName || 'Student') + '</div><div style="font-size:11px;color:var(--tmu);font-family:\'JetBrains Mono\',monospace;">' + escapeHtml(rec.regNo || '') + '</div></td>' +
        '<td><div style="font-weight:600;">' + escapeHtml(rec.date || '') + '</div><div style="font-size:11px;color:var(--tmu);">Period ' + (rec.periodNumber || 1) + '</div></td>' +
        '<td><span style="font-weight:600;">' + escapeHtml(rec.className || '') + '</span> <span style="font-size:11px;color:var(--tmu);">(' + escapeHtml(rec.department || '') + ')</span></td>' +
        '<td>' + escapeHtml(rec.subjectName || rec.subjectCode || '—') + '</td>' +
        '<td><span class="badge ' + badgeCls + '">' + statusLbl + '</span></td>' +
        '<td style="font-size:11.5px;color:var(--tmu);">' + escapeHtml(rec.remarks || '—') + '</td>' +
        '<td style="text-align:center;width:170px;">' +
        '<div class="ug-actions-cell">' +
        '<button class="ug-action-btn edit" onclick="openUGAttEdit(\'' + rec._id + '\')" title="Edit Attendance">✏️ Edit</button>' +
        '<button class="ug-action-btn del" onclick="openUGDeleteModal(\'' + rec._id + '\')" title="Delete Entry">🗑️ Delete</button>' +
        '</div>' +
        '</td>' +
        '</tr>';
    }).join("");
  } else {
    var idColTitle = (role === "student") ? ("Reg. Number" + ugSortIndicator('registerNo')) : (role === "teacher" ? ("Emp ID" + ugSortIndicator('employeeNo')) : ("Admin ID" + ugSortIndicator('employeeNo')));
    var idColField = (role === "student") ? 'registerNo' : 'employeeNo';
    var extraColTitle = (role === "student") ? "Class &amp; Dept" : (role === "teacher" ? "Dept &amp; Designation" : "Department &amp; Access");

    thead.innerHTML = '<tr>' +
      selectAllTh +
      '<th class="sortable" onclick="ugSortBy(\'name\')">User / Name' + ugSortIndicator('name') + '</th>' +
      '<th class="sortable" onclick="ugSortBy(\'' + idColField + '\')">' + idColTitle + '</th>' +
      '<th class="sortable" onclick="ugSortBy(\'username\')">Username' + ugSortIndicator('username') + '</th>' +
      '<th>' + extraColTitle + '</th>' +
      '<th class="sortable" onclick="ugSortBy(\'status\')">Status' + ugSortIndicator('status') + '</th>' +
      '<th style="width:330px;text-align:center;">Actions</th>' +
      '</tr>';

    tbody.innerHTML = data.map(function (u) {
      var isChecked = _ugState.selectedIds.has(u._id);
      var badgeCls = (u.status === "active") ? "badge-active" : ((u.status === "locked") ? "badge-locked" : "badge-inactive");
      var badgeLbl = (u.status === "active") ? "🟢 Active" : ((u.status === "locked") ? "🔴 Locked" : "⚪ Inactive");

      var idDisplay = "";
      var subInfo = "";
      if (role === "student") {
        idDisplay = '<div style="font-weight:700;font-family:\'JetBrains Mono\',monospace;color:var(--gD);">' + escapeHtml(u.registerNo || '—') + '</div>';
        subInfo = '<div style="font-weight:600;">' + escapeHtml(u.class || '—') + (u.section ? ' (' + u.section + ')' : '') + (u.isRep ? ' ⭐ Rep' : '') + '</div>' +
          '<div style="font-size:11px;color:var(--tmu);">' + escapeHtml(u.department || '') + '</div>';
      } else if (role === "teacher") {
        idDisplay = '<div style="font-weight:700;font-family:\'JetBrains Mono\',monospace;color:var(--gD);">' + escapeHtml(u.employeeNo || '—') + '</div>';
        subInfo = '<div style="font-weight:600;">' + escapeHtml(u.department || '') + '</div>' +
          '<div style="font-size:11px;color:var(--tmu);">' + escapeHtml(u.designation || 'Faculty') + '</div>';
      } else {
        idDisplay = '<div style="font-weight:700;font-family:\'JetBrains Mono\',monospace;color:var(--gD);">' + escapeHtml(u.employeeNo || u.role || '—') + '</div>';
        subInfo = '<div style="font-weight:600;">' + escapeHtml(u.department || 'Administration') + '</div>';
      }

      var statusBtn = "";
      if (u.status === "locked") {
        statusBtn = '<button class="ug-action-btn unlock" onclick="ugUnlockAccount(\'' + u._id + '\')" title="Unlock Brute-Force Locked Account">🔓 Unlock</button>';
      } else if (u.status === "active") {
        statusBtn = '<button class="ug-action-btn status deact" onclick="ugToggleStatus(\'' + u._id + '\',\'' + u.status + '\')" title="Deactivate Account">⚡ Deactivate</button>';
      } else {
        statusBtn = '<button class="ug-action-btn status" onclick="ugToggleStatus(\'' + u._id + '\',\'' + u.status + '\')" title="Activate Account">🟢 Activate</button>';
      }

      return '<tr class="' + (isChecked ? 'ug-row-selected' : '') + '">' +
        '<td style="text-align:center;"><input type="checkbox" onchange="ugToggleRowSelect(\'' + u._id + '\')" ' + (isChecked ? 'checked' : '') + '></td>' +
        '<td>' +
        '<div style="font-weight:700;color:var(--td);">' + escapeHtml(u.name || u.fullName || u.username) + '</div>' +
        '<div style="font-size:11px;color:var(--tmu);">' + escapeHtml(u.email || 'No email registered') + '</div>' +
        '</td>' +
        '<td>' + idDisplay + '</td>' +
        '<td><code style="font-size:12px;background:var(--gLt);padding:2px 6px;border-radius:4px;color:var(--gD);">@' + escapeHtml(u.username) + '</code></td>' +
        '<td>' + subInfo + '</td>' +
        '<td><span class="badge ' + badgeCls + '">' + badgeLbl + '</span>' + (u.failedLogins > 0 ? ' <span style="font-size:10px;color:#dc2626;">(' + u.failedLogins + ' fails)</span>' : '') + '</td>' +
        '<td style="text-align:center;width:330px;">' +
        '<div class="ug-actions-cell">' +
        '<button class="ug-action-btn edit" onclick="openUGEdit(\'' + u._id + '\')" title="Edit Profile">✏️ Edit</button>' +
        '<button class="ug-action-btn pw" onclick="openUGPasswordReset(\'' + u._id + '\')" title="Reset Password">🔑 Password</button>' +
        statusBtn +
        '<button class="ug-action-btn del" onclick="openUGDeleteModal(\'' + u._id + '\')" title="Delete User">🗑️ Delete</button>' +
        '</div>' +
        '</td>' +
        '</tr>';
    }).join("");
  }
}

function ugUpdatePagination() {
  var infoEl = document.getElementById("ug-page-info");
  var prevBtn = document.getElementById("ug-prev-btn");
  var nextBtn = document.getElementById("ug-next-btn");
  var numsEl = document.getElementById("ug-page-numbers");

  var page = _ugState.page;
  var pages = _ugState.pages;
  var total = _ugState.total;
  var limit = _ugState.limit;

  if (infoEl) {
    if (limit === 0 || limit >= total) {
      infoEl.textContent = 'Showing all ' + total + ' record(s)';
    } else {
      var start = (page - 1) * limit + 1;
      var end = Math.min(page * limit, total);
      infoEl.textContent = 'Showing ' + (total === 0 ? 0 : start) + '–' + end + ' of ' + total + ' record(s)';
    }
  }

  if (prevBtn) prevBtn.disabled = (page <= 1);
  if (nextBtn) nextBtn.disabled = (page >= pages);

  if (numsEl) {
    var html = "";
    var maxDisplay = 5;
    var startPage = Math.max(1, page - 2);
    var endPage = Math.min(pages, startPage + maxDisplay - 1);
    if (endPage - startPage < maxDisplay - 1) {
      startPage = Math.max(1, endPage - maxDisplay + 1);
    }

    for (var p = startPage; p <= endPage; p++) {
      html += '<button class="ug-page-btn ' + (p === page ? 'active' : '') + '" onclick="ugGoToPage(' + p + ')">' + p + '</button>';
    }
    numsEl.innerHTML = html;
  }
}

function ugToggleSelectAll(chk) {
  var isChecked = chk.checked;
  var data = _ugState.data;
  if (isChecked) {
    data.forEach(function (r) { _ugState.selectedIds.add(r._id); });
  } else {
    _ugState.selectedIds.clear();
  }
  ugUpdateBulkBar();
  renderUGTable();
}

function ugToggleRowSelect(id) {
  if (_ugState.selectedIds.has(id)) {
    _ugState.selectedIds.delete(id);
  } else {
    _ugState.selectedIds.add(id);
  }
  ugUpdateBulkBar();
  renderUGTable();
}

function ugClearSelection() {
  _ugState.selectedIds.clear();
  ugUpdateBulkBar();
  renderUGTable();
}

function ugUpdateBulkBar() {
  var bar = document.getElementById("ug-bulk-bar");
  var countEl = document.getElementById("ug-bulk-count");
  var count = _ugState.selectedIds.size;

  if (bar) {
    if (count > 0) {
      bar.style.display = "flex";
      if (countEl) countEl.textContent = count + " item(s) selected";
    } else {
      bar.style.display = "none";
    }
  }
}

function ugBulkAction(action) {
  var selected = Array.from(_ugState.selectedIds);
  if (selected.length === 0) {
    showToast("⚠️ No items selected", "warning");
    return;
  }

  if (action === "delete") {
    if (!confirm("Are you sure you want to delete/deactivate " + selected.length + " selected user(s)?")) return;
  }

  var tok = getToken();
  showToast("Executing bulk " + action + " on " + selected.length + " items…", "info");

  fetch("/api/users/bulk-action", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + tok },
    body: JSON.stringify({ userIds: selected, action: action })
  })
    .then(function (r) { return r.json(); })
    .then(function (res) {
      if (res.error) {
        showToast("❌ " + res.error, "danger");
        return;
      }
      showToast("✅ " + (res.message || "Bulk action completed successfully"));
      _ugState.selectedIds.clear();
      ugUpdateBulkBar();
      ugLoadData();
    })
    .catch(function (err) {
      showToast("❌ Bulk action failed: " + (err.message || ""), "danger");
    });
}

function onUGFullNameInput() {
  var fullName = document.getElementById("ug-e-fullname") ? document.getElementById("ug-e-fullname").value.trim() : "";
  var firstEl = document.getElementById("ug-e-firstname");
  var lastEl = document.getElementById("ug-e-lastname");
  if (fullName) {
    var parts = fullName.split(/\s+/);
    if (firstEl && !firstEl.dataset.userModified) {
      firstEl.value = parts[0] || "";
    }
    if (lastEl && !lastEl.dataset.userModified) {
      lastEl.value = parts.slice(1).join(" ") || "";
    }
  }
}

function openUGEdit(id) {
  var user = _ugState.data.find(function (u) { return u._id === id; });
  if (!user) return;

  document.getElementById("ug-e-id").value = user._id;
  document.getElementById("ug-e-role").value = user.role;
  document.getElementById("ug-e-fullname").value = user.name || user.fullName || "";
  document.getElementById("ug-e-firstname").value = user.firstName || "";
  document.getElementById("ug-e-lastname").value = user.lastName || "";
  document.getElementById("ug-e-username").value = user.username || "";
  document.getElementById("ug-e-email").value = user.email || "";
  document.getElementById("ug-e-status").value = user.status || "active";
  document.getElementById("ug-e-must-change-pw").checked = !!user.mustChangePassword;

  // Auto-split fallback if first/last are empty
  if (!user.firstName && !user.lastName && (user.name || user.fullName)) {
    var parts = (user.name || user.fullName).trim().split(/\s+/);
    document.getElementById("ug-e-firstname").value = parts[0] || "";
    document.getElementById("ug-e-lastname").value = parts.slice(1).join(" ") || "";
  }

  document.getElementById("ug-fields-student").style.display = (user.role === "student") ? "block" : "none";
  document.getElementById("ug-fields-teacher").style.display = (user.role === "teacher") ? "block" : "none";
  document.getElementById("ug-fields-admin").style.display = (user.role === "admin") ? "block" : "none";

  if (user.role === "student") {
    document.getElementById("ug-e-stu-regno").value = user.registerNo || "";
    document.getElementById("ug-e-stu-trackid").value = user.trackId || user.studentTrackId || user.registerNo || "";
    document.getElementById("ug-e-stu-dept").value = user.department || "";
    document.getElementById("ug-e-stu-course-type").value = user.courseType || "UG";
    document.getElementById("ug-e-stu-branch").value = user.branch || "";

    var acYear = user.academicYear || user.admissionYear || "";
    if (acYear && !acYear.includes("-")) {
      acYear = acYear + "-" + (parseInt(acYear, 10) + 1);
    }
    var yrEl = document.getElementById("ug-e-stu-year");
    if (yrEl) yrEl.value = acYear;

    var batch = user.batch || user.batchTrackId || "";
    populateUGBatches(acYear, batch);
    updateUGStuClassList(user.class || "");

    var secEl = document.getElementById("ug-e-stu-section");
    if (secEl && user.section) secEl.value = user.section;

    document.getElementById("ug-e-stu-is-rep").checked = !!user.isRep;
  } else if (user.role === "teacher") {
    document.getElementById("ug-e-tch-empno").value = user.employeeNo || "";
    document.getElementById("ug-e-tch-dept").value = user.department || "";
    document.getElementById("ug-e-tch-desig").value = user.designation || "Assistant Professor";
    document.getElementById("ug-e-tch-def-att").value = user.defaultAttendanceStatus || "Present";

    var rights = Array.isArray(user.adminRights) ? user.adminRights : (user.adminRights ? [user.adminRights] : []);
    var isAll = rights.includes("all") || user.adminRights === "all";
    var hasAdmin = isAll || rights.some(function (r) { return r && r !== "none"; }) || !!user.isAdmin;

    document.getElementById("ug-e-tch-is-admin").checked = hasAdmin;
    ugToggleAdminPrivs(hasAdmin);

    document.getElementById("ug-e-right-control").checked = isAll || rights.includes("controlPage");
    document.getElementById("ug-e-right-manage").checked = isAll || rights.includes("managePage");
    document.getElementById("ug-e-right-timetable").checked = isAll || rights.includes("timetablePage");
    document.getElementById("ug-e-right-bulk").checked = isAll || rights.includes("bulkPage");
    document.getElementById("ug-e-right-settings").checked = isAll || rights.includes("settingsPage");
    document.getElementById("ug-e-right-reports").checked = isAll || rights.includes("reportsModule");
    document.getElementById("ug-e-right-download").checked = isAll || rights.includes("downloadDatas");
    document.getElementById("ug-e-right-adders").checked = isAll || rights.includes("adderModules");
    document.getElementById("ug-e-right-deletings").checked = isAll || rights.includes("deletings");
  } else if (user.role === "admin") {
    document.getElementById("ug-e-adm-dept").value = user.department || "Administration";
    document.getElementById("ug-e-adm-empno").value = user.employeeNo || "";
  }

  document.getElementById("ug-edit-modal-title").textContent = "Edit " + capitalize(user.role) + ": " + (user.name || user.fullName || user.username);
  document.getElementById("ug-edit-modal").classList.add("open");
}

function ugCloseEditModal() {
  document.getElementById("ug-edit-modal").classList.remove("open");
}

function ugSubmitEdit() {
  var id = document.getElementById("ug-e-id").value;
  var role = document.getElementById("ug-e-role").value;
  var tok = getToken();

  var fullName = document.getElementById("ug-e-fullname").value.trim();
  var firstName = document.getElementById("ug-e-firstname").value.trim();
  var lastName = document.getElementById("ug-e-lastname").value.trim();
  var username = document.getElementById("ug-e-username").value.trim();
  var email = document.getElementById("ug-e-email").value.trim();
  var status = document.getElementById("ug-e-status").value;
  var mustChangePw = document.getElementById("ug-e-must-change-pw").checked;

  if (!fullName || !username) {
    showToast("⚠️ Full Name and Username are required", "warning");
    return;
  }

  var payload = {
    fullName: fullName,
    name: fullName,
    firstName: firstName,
    lastName: lastName,
    username: username,
    email: email,
    status: status,
    mustChangePassword: mustChangePw
  };

  if (role === "student") {
    payload.registerNo = document.getElementById("ug-e-stu-regno").value.trim();
    payload.department = document.getElementById("ug-e-stu-dept").value.trim();
    payload.class = document.getElementById("ug-e-stu-class").value.trim();
    payload.section = document.getElementById("ug-e-stu-section").value.trim();
    payload.courseType = document.getElementById("ug-e-stu-course-type").value;
    payload.branch = document.getElementById("ug-e-stu-branch").value;
    payload.academicYear = document.getElementById("ug-e-stu-year").value;
    payload.admissionYear = document.getElementById("ug-e-stu-year").value;
    payload.batch = document.getElementById("ug-e-stu-batch").value;
    payload.batchTrackId = document.getElementById("ug-e-stu-batch").value;
    payload.isRep = document.getElementById("ug-e-stu-is-rep").checked;
  } else if (role === "teacher") {
    payload.employeeNo = document.getElementById("ug-e-tch-empno").value.trim();
    payload.department = document.getElementById("ug-e-tch-dept").value.trim();
    payload.designation = document.getElementById("ug-e-tch-desig").value.trim();
    payload.defaultAttendanceStatus = document.getElementById("ug-e-tch-def-att").value;

    var isAdmin = document.getElementById("ug-e-tch-is-admin").checked;
    payload.isAdmin = isAdmin;
    if (isAdmin) {
      var rights = [];
      if (document.getElementById("ug-e-right-control").checked) rights.push("controlPage");
      if (document.getElementById("ug-e-right-manage").checked) rights.push("managePage");
      if (document.getElementById("ug-e-right-timetable").checked) rights.push("timetablePage");
      if (document.getElementById("ug-e-right-bulk").checked) rights.push("bulkPage");
      if (document.getElementById("ug-e-right-settings").checked) rights.push("settingsPage");
      if (document.getElementById("ug-e-right-reports").checked) rights.push("reportsModule");
      if (document.getElementById("ug-e-right-download").checked) rights.push("downloadDatas");
      if (document.getElementById("ug-e-right-adders").checked) rights.push("adderModules");
      if (document.getElementById("ug-e-right-deletings").checked) rights.push("deletings");
      payload.adminRights = rights.length ? rights : ["none"];
    } else {
      payload.adminRights = ["none"];
    }
  } else if (role === "admin") {
    payload.department = document.getElementById("ug-e-adm-dept").value.trim();
    payload.employeeNo = document.getElementById("ug-e-adm-empno").value.trim();
    payload.adminRights = ["all"];
    payload.isAdmin = true;
  }

  showToast("Saving user changes to DB…", "info");

  fetch("/api/users/" + id, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + tok },
    body: JSON.stringify(payload)
  })
    .then(function (r) { return r.json(); })
    .then(function (res) {
      if (res.error) {
        showToast("❌ " + res.error, "danger");
        return;
      }
      showToast("✅ User details updated successfully");
      ugCloseEditModal();
      ugLoadData();
    })
    .catch(function (err) {
      showToast("❌ Failed to update user: " + (err.message || ""), "danger");
    });
}

function ugExportCSV() {
  var data = _ugState.data || [];
  if (data.length === 0) {
    showToast("⚠️ No data available to export", "warning");
    return;
  }

  var role = _ugState.role;
  var csvRows = [];

  if (role === "student") {
    csvRows.push([
      "Register Number", "Track ID", "Full Name", "First Name", "Last Name",
      "Username", "Email", "Department", "Course Level", "Branch",
      "Academic Year", "Batch", "Class", "Section", "Class Rep",
      "Status", "Failed Logins", "Last Active", "Created At"
    ]);
    data.forEach(function (u) {
      csvRows.push([
        u.registerNo || "",
        u.trackId || u.studentTrackId || "",
        u.name || u.fullName || "",
        u.firstName || "",
        u.lastName || "",
        u.username || "",
        u.email || "",
        u.department || "",
        u.courseType || "UG",
        u.branch || "",
        u.academicYear || u.admissionYear || "",
        u.batch || u.batchTrackId || "",
        u.class || "",
        u.section || "",
        u.isRep ? "Yes" : "No",
        u.status || "active",
        u.failedLogins || 0,
        u.lastLogin ? new Date(u.lastLogin).toISOString() : "Never",
        u.createdAt ? new Date(u.createdAt).toISOString() : ""
      ]);
    });
  } else if (role === "teacher") {
    csvRows.push([
      "Employee Number", "Track ID", "Full Name", "First Name", "Last Name",
      "Username", "Email", "Department", "Designation",
      "Default Attendance Status", "Is Admin", "Admin Rights",
      "Status", "Failed Logins", "Last Active", "Created At"
    ]);
    data.forEach(function (u) {
      var rights = Array.isArray(u.adminRights) ? u.adminRights.join("; ") : (u.adminRights || "");
      csvRows.push([
        u.employeeNo || "",
        u.trackId || "",
        u.name || u.fullName || "",
        u.firstName || "",
        u.lastName || "",
        u.username || "",
        u.email || "",
        u.department || "",
        u.designation || "Faculty",
        u.defaultAttendanceStatus || "Present",
        u.isAdmin ? "Yes" : "No",
        rights,
        u.status || "active",
        u.failedLogins || 0,
        u.lastLogin ? new Date(u.lastLogin).toISOString() : "Never",
        u.createdAt ? new Date(u.createdAt).toISOString() : ""
      ]);
    });
  } else if (role === "admin") {
    csvRows.push([
      "Employee Number / ID", "Track ID", "Full Name", "Username",
      "Email", "Department", "Role", "Admin Rights",
      "Status", "Failed Logins", "Last Active", "Created At"
    ]);
    data.forEach(function (u) {
      csvRows.push([
        u.employeeNo || "",
        u.trackId || "",
        u.name || u.fullName || "",
        u.username || "",
        u.email || "",
        u.department || "Administration",
        u.role || "admin",
        "all",
        u.status || "active",
        u.failedLogins || 0,
        u.lastLogin ? new Date(u.lastLogin).toISOString() : "Never",
        u.createdAt ? new Date(u.createdAt).toISOString() : ""
      ]);
    });
  } else if (role === "attendance") {
    csvRows.push([
      "Date", "Period", "Student Name", "Register Number",
      "Student Track ID", "Class", "Department",
      "Subject Code", "Subject Name", "Status", "Remarks"
    ]);
    data.forEach(function (r) {
      csvRows.push([
        r.date || "",
        r.periodNumber || 1,
        r.studentName || "",
        r.regNo || "",
        r.studentTrackId || "",
        r.className || "",
        r.department || "",
        r.subjectCode || "",
        r.subjectName || "",
        r.status || "",
        (r.remarks || "").replace(/,/g, " ")
      ]);
    });
  }

  var csvContent = "data:text/csv;charset=utf-8,\uFEFF" + csvRows.map(function (e) {
    return e.map(function (cell) {
      return '"' + String(cell === undefined || cell === null ? "" : cell).replace(/"/g, '""') + '"';
    }).join(",");
  }).join("\n");

  var encodedUri = encodeURI(csvContent);
  var link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", "eams_" + role + "_full_export_" + (new Date().toISOString().slice(0, 10)) + ".csv");
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showToast("📥 Exported " + data.length + " " + role + " records with all fields to CSV");
}

function openUGPasswordReset(id) {
  var user = _ugState.data.find(function (u) { return u._id === id; });
  if (!user) return;

  document.getElementById("ug-pw-user-id").value = user._id;
  document.getElementById("ug-pw-new").value = "";
  document.getElementById("ug-pw-conf").value = "";
  document.getElementById("ug-pw-force-change").checked = true;

  var desc = document.getElementById("ug-pw-user-desc");
  if (desc) {
    desc.textContent = "Setting a new password for @" + user.username + " (" + (user.name || user.fullName) + ") will terminate all active sessions.";
  }

  document.getElementById("ug-pw-modal").classList.add("open");
}

function ugClosePwModal() {
  document.getElementById("ug-pw-modal").classList.remove("open");
}

function ugSubmitPasswordReset() {
  var id = document.getElementById("ug-pw-user-id").value;
  var nw = document.getElementById("ug-pw-new").value.trim();
  var conf = document.getElementById("ug-pw-conf").value.trim();
  var forceChange = document.getElementById("ug-pw-force-change").checked;

  if (!nw || !conf) {
    showToast("⚠️ Please enter and confirm the new password", "warning");
    return;
  }
  if (nw.length < 8) {
    showToast("⚠️ Password must be at least 8 characters long", "warning");
    return;
  }
  if (nw !== conf) {
    showToast("⚠️ Passwords do not match", "warning");
    return;
  }

  var tok = getToken();
  showToast("Updating password…", "info");

  fetch("/api/users/" + id + "/reset-password", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + tok },
    body: JSON.stringify({ newPassword: nw, requireChangeOnLogin: forceChange })
  })
    .then(function (r) { return r.json(); })
    .then(function (res) {
      if (res.error) {
        showToast("❌ " + res.error, "danger");
        return;
      }
      showToast("✅ Password reset successfully");
      ugClosePwModal();
      ugLoadData();
    })
    .catch(function (err) {
      showToast("❌ Password reset failed: " + (err.message || ""), "danger");
    });
}

function ugUnlockAccount(id) {
  var tok = getToken();
  showToast("Unlocking account…", "info");

  fetch("/api/users/" + id + "/unlock", {
    method: "POST",
    headers: { Authorization: "Bearer " + tok }
  })
    .then(function (r) { return r.json(); })
    .then(function (res) {
      if (res.error) {
        showToast("❌ " + res.error, "danger");
        return;
      }
      showToast("✅ Account unlocked successfully");
      ugLoadData();
    })
    .catch(function (err) {
      showToast("❌ Failed to unlock account", "danger");
    });
}

function ugToggleStatus(id, currentStatus) {
  var newStatus = (currentStatus === "active") ? "inactive" : "active";
  var tok = getToken();

  showToast((newStatus === "active" ? "Activating" : "Deactivating") + " account…", "info");

  fetch("/api/users/" + id, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + tok },
    body: JSON.stringify({ status: newStatus })
  })
    .then(function (r) { return r.json(); })
    .then(function (res) {
      if (res.error) {
        showToast("❌ " + res.error, "danger");
        return;
      }
      showToast("✅ Account set to " + newStatus);
      ugLoadData();
    })
    .catch(function () {
      showToast("❌ Failed to toggle account status", "danger");
    });
}

function openUGDeleteModal(id) {
  var rec = _ugState.data.find(function (u) { return u._id === id; });
  var role = _ugState.role;
  var delIdInput = document.getElementById("ug-del-id");
  var delRoleInput = document.getElementById("ug-del-role");
  var titleEl = document.getElementById("ug-del-title");
  var msgEl = document.getElementById("ug-del-msg");

  if (delIdInput) delIdInput.value = id;
  if (delRoleInput) delRoleInput.value = role;

  if (role === "attendance") {
    if (titleEl) titleEl.textContent = "Delete Attendance Entry?";
    if (msgEl) msgEl.textContent = "Are you sure you want to permanently delete this attendance record for " + (rec ? rec.studentName : "this student") + "?";
  } else {
    var name = rec ? (rec.name || rec.fullName || rec.username) : "this user";
    if (titleEl) titleEl.textContent = "Delete User: " + name + "?";
    if (msgEl) msgEl.textContent = "Permanently remove @" + (rec ? rec.username : "") + " and associated profile? A snapshot will be saved in the Undo log.";
  }

  var modal = document.getElementById("ug-del-modal");
  if (modal) modal.classList.add("open");
}

function ugCloseDeleteModal() {
  var modal = document.getElementById("ug-del-modal");
  if (modal) modal.classList.remove("open");
}

function ugConfirmDeleteRecord() {
  var id = document.getElementById("ug-del-id").value;
  var role = document.getElementById("ug-del-role").value || _ugState.role;
  if (!id) return;

  var tok = getToken();
  var url = (role === "attendance") ? ("/api/attendance/" + id) : ("/api/users/" + id);

  showToast("Deleting record…", "info");

  fetch(url, {
    method: "DELETE",
    headers: { Authorization: "Bearer " + tok }
  })
    .then(function (r) { return r.json(); })
    .then(function (res) {
      if (res.error) {
        showToast("❌ " + res.error, "danger");
        return;
      }
      showToast("✅ Record removed / snapshot saved to Undo Log");
      ugCloseDeleteModal();
      _ugState.selectedIds.delete(id);
      ugUpdateBulkBar();
      ugLoadData();
    })
    .catch(function (err) {
      showToast("❌ Delete failed: " + (err.message || ""), "danger");
    });
}

function openUGAttEdit(id) {
  var rec = _ugState.data.find(function (r) { return r._id === id; });
  if (!rec) return;

  document.getElementById("ug-att-rec-id").value = rec._id;
  document.getElementById("ug-att-student-trackid").value = rec.studentTrackId || "";
  document.getElementById("ug-att-student-name").textContent = rec.studentName + " (" + (rec.regNo || rec.studentTrackId) + ")";
  document.getElementById("ug-att-meta").textContent = (rec.className || "") + " · " + (rec.subjectName || "") + " · " + (rec.date || "") + " (Period " + (rec.periodNumber || 1) + ")";
  document.getElementById("ug-att-status").value = rec.status || "present";
  document.getElementById("ug-att-remarks").value = rec.remarks || "";

  document.getElementById("ug-att-modal").classList.add("open");
}

function ugCloseAttModal() {
  document.getElementById("ug-att-modal").classList.remove("open");
}

function ugSubmitAttEdit() {
  var id = document.getElementById("ug-att-rec-id").value;
  var statusVal = document.getElementById("ug-att-status").value;
  var remarksVal = document.getElementById("ug-att-remarks").value.trim();
  var studentTrackId = document.getElementById("ug-att-student-trackid").value;
  var tok = getToken();

  showToast("Updating attendance record…", "info");

  fetch("/api/attendance/" + id, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + tok },
    body: JSON.stringify({ status: statusVal, remarks: remarksVal, studentTrackId: studentTrackId })
  })
    .then(function (r) { return r.json(); })
    .then(function (res) {
      if (res.error) {
        showToast("❌ " + res.error, "danger");
        return;
      }
      showToast("✅ Attendance record updated successfully");
      ugCloseAttModal();
      ugLoadData();
    })
    .catch(function (err) {
      showToast("❌ Failed to update attendance: " + (err.message || ""), "danger");
    });
}

function formatTimeAgo(date) {
  if (!date || isNaN(date.getTime())) return "Never";
  var seconds = Math.floor((new Date() - date) / 1000);
  if (seconds < 60) return "Just now";
  var minutes = Math.floor(seconds / 60);
  if (minutes < 60) return minutes + "m ago";
  var hours = Math.floor(minutes / 60);
  if (hours < 24) return hours + "h ago";
  var days = Math.floor(hours / 24);
  if (days < 30) return days + "d ago";
  return date.toLocaleDateString();
}

function capitalize(str) {
  if (!str) return "";
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Modals / Clear Storage
function openClearStorageModal() {
  openModal("m-clear-storage");
}
function confirmClearStorage() {
  var checked = document.querySelectorAll(
    "#m-clear-storage input[type=checkbox]:checked",
  );

  if (checked.length === 0) {
    showToast("⚠️ Select at least one item");
    return;
  }

  var clearedToken = false;
  checked.forEach(function (c) {
    if (c.value === "eams_token") clearedToken = true;
    sessionStorage.removeItem(c.value);
  });

  closeModalBg("m-clear-storage");

  if (clearedToken) {
    showToast("✅ Session cleared — logging out");
    setTimeout(function () {
      window.location.href = "index.html";
    }, 600);
  } else {
    showToast("✅ Cleared " + checked.length + " item(s)");
  }
}
function openAttendanceDateModal() {
  openModal("m-attendance-date");
}
function confirmAttendanceDelete(mode) {
  var tok = getToken();

  if (mode === "all") {
    if (!confirm("Delete ALL attendance records?")) return;

    fetch("/api/attendance/all", {
      method: "DELETE",
      headers: { Authorization: "Bearer " + tok },
    })
      .then(function (r) {
        if (r.ok) {
          showToast("All attendance records cleared");
          closeModalBg("m-attendance-date");
        } else {
          r.json().then(function (d) {
            showToast(d.error || "Failed", "danger");
          });
        }
      })
      .catch(function () {
        showToast("Network error", "danger");
      });
  } else {
    var from = document.getElementById("att-del-from")?.value;

    var to = document.getElementById("att-del-to")?.value;

    if (!from || !to) {
      showToast("Select date range");
      return;
    }

    fetch("/api/attendance/clear", {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + tok,
      },
      body: JSON.stringify({ from: from, to: to }),
    })
      .then(function (r) {
        if (r.ok) {
          showToast("Attendance records cleared");
          closeModalBg("m-attendance-date");
        } else {
          r.json().then(function (d) {
            showToast(d.error || "Failed", "danger");
          });
        }
      })
      .catch(function () {
        showToast("Network error", "danger");
      });
  }
}

function deleteAttendance(id) {
  var tok = getToken();

  if (!confirm("Delete this attendance record?")) return;

  fetch("/api/attendance/" + id, {
    method: "DELETE",
    headers: { Authorization: "Bearer " + tok },
  })
    .then(function (r) {
      if (r.ok) {
        showToast("Deleted");
        ugApplyFilters();
      } else {
        showToast("Delete failed", "danger");
      }
    })
    .catch(function () {
      showToast("Network error", "danger");
    });
}

// Special Password
function toggleSppwEye() {
  var inp = document.getElementById("sppw-input");

  if (inp) inp.type = inp.type === "password" ? "text" : "password";
}
function verifySpecialPw() {
  var pw = document.getElementById("sppw-input")?.value;

  var onSuccess = document.getElementById("sppw-on-success")?.value || "";

  if (!pw) {
    showToast("Enter your password");
    return;
  }

  var tok = getToken();

  fetch("/api/auth/verify-password", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + tok,
    },
    body: JSON.stringify({ password: pw }),
  })
    .then(function (r) {
      return r.json();
    })

    .then(function (d) {
      if (d.verified) {
        showToast("✅ Verified");
        closeModalBg("m-special-pw");
        if (onSuccess && typeof window[onSuccess] === "function")
          window[onSuccess]();
      } else {
        showToast("❌ " + (d.error || "Wrong password"), "danger");
      }
    })
    .catch(function () {
      showToast("Network error", "danger");
    });
}

// ── Page Loader Controller (Adapted from Admin Portal) ──
var loaderMsgEl = document.getElementById('loader-msg');
var loaderEtaEl = document.getElementById('loader-eta');

function setLoaderMsg(idx, text) {
  if (!loaderMsgEl) return;
  loaderMsgEl.classList.add('msg-fade');
  setTimeout(function () {
    loaderMsgEl.textContent = text;
    loaderMsgEl.classList.remove('msg-fade');
    for (var s = 0; s < 5; s++) {
      var dot = document.getElementById('lstep-' + s);
      if (!dot) continue;
      dot.className = 'loader-step' + (s < idx ? ' done' : s === idx ? ' active' : '');
    }
  }, 120);
}

function formatEta(ms) {
  var sec = Math.max(1, Math.round(ms / 1000));
  return sec + 's';
}

// Init
(function () {
  setLoaderMsg(0, 'Checking System Privileges…');

  updateClock();
  setInterval(updateClock, 1000);

  var _etaMs = 1200;
  var _etaTick = setInterval(function () {
    if (_etaMs <= 0) return;
    _etaMs = Math.max(0, _etaMs - 200);
    if (loaderEtaEl) {
      if (_etaMs > 0) {
        loaderEtaEl.innerHTML = 'ETA: <span class="eta-time">' + formatEta(_etaMs) + '</span> — loading control telemetry';
      } else {
        loaderEtaEl.innerHTML = '✔ Finalizing system panel…';
      }
    }
  }, 200);

  setTimeout(function () {
    setLoaderMsg(1, 'Loading System Services & Health…');
    nav('overview');
  }, 300);

  setTimeout(function () {
    setLoaderMsg(2, 'Gathering User Matrix & Danger Zones…');
  }, 600);

  setTimeout(function () {
    setLoaderMsg(3, 'Synchronizing Audit Streams…');
  }, 900);

  setTimeout(function () {
    setLoaderMsg(4, 'Readying Control Panel…');
    clearInterval(_etaTick);
    if (loaderEtaEl) loaderEtaEl.innerHTML = '✔ System ready';
    var loader = document.getElementById('page-loader');
    if (loader) {
      loader.classList.add('loader-fade');
      setTimeout(function () {
        loader.style.display = 'none';
      }, 360);
    }
  }, 1300);
})();
// Errors mode toggling
var _errorsMode = "n";
var _errorsN = 20;
function setErrorsMode(mode) {
  _errorsMode = mode;

  document
    .getElementById("err-btn-week")
    ?.classList.toggle("active", mode === "week");

  document
    .getElementById("err-btn-n")
    ?.classList.toggle("active", mode === "n");

  loadHealth();
}

// Delete All Adder
function openDeleteAdderModal() {
  document.querySelectorAll(".adder-chk").forEach(function (c) {
    c.checked = false;
  });

  openModal("m-delete-adder");
}

function confirmDeleteAdder() {
  var selected = Array.from(
    document.querySelectorAll(".adder-chk:checked"),
  ).map(function (c) {
    return c.value;
  });

  if (selected.length === 0) {
    showToast("Select at least one collection");
    return;
  }

  if (
    !confirm(
      "Permanently delete: " + selected.join(", ") + "? This cannot be undone.",
    )
  )
    return;

  var tok = getToken();

  fetch("/api/system/delete-adder", {
    method: "POST",

    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + tok,
    },

    body: JSON.stringify({ collections: selected }),
  })
    .then(function (r) {
      return r.json();
    })

    .then(function (d) {
      if (d.success) {
        showToast("✅ Deleted: " + d.deleted + " records");
        closeModalBg("m-delete-adder");
      } else {
        showToast(d.error || "Delete failed", "danger");
      }
    })
    .catch(function () {
      showToast("Network error", "danger");
    });
}

// Clear Storage select-all
function toggleClearAll(el) {
  document.querySelectorAll(".clr-chk").forEach(function (c) {
    c.checked = el.checked;
  });
}

// Navigation helpers
function goBack() {
  if (currentUser && currentUser.role === 'teacher') {
    window.location.href = "selector.html";
  } else {
    window.location.href = "admin.html";
  }
}

//  BROADCASTS & LIVE ANNOUNCEMENTS
function toggleForceAllRoles(chk) {
  var tChk = document.getElementById('bc-role-teachers');
  var sChk = document.getElementById('bc-role-students');
  if (chk.checked) {
    if (tChk) tChk.disabled = true;
    if (sChk) sChk.disabled = true;
  } else {
    if (tChk) tChk.disabled = false;
    if (sChk) sChk.disabled = false;
  }
}

function loadActiveBroadcastStatus() {
  fetch('/api/settings/public')
    .then(function (r) { return r.json(); })
    .then(function (pub) {
      if (pub.broadcast && pub.broadcast.defaultPopupDurationSec) {
        var durEl = document.getElementById('bc-duration');
        if (durEl && !durEl.dataset.userEdited) durEl.value = pub.broadcast.defaultPopupDurationSec;
      }
      if (pub.institution) {
        var shortN = pub.institution.institutionShort || '';
        document.title = shortN ? ('EAMS – Control Center | ' + shortN) : 'EAMS – Control Center';
      }
    }).catch(function () { });

  apiCall('GET', '/settings/broadcast')
    .then(function (bcast) {
      var banner = document.getElementById('bc-active-banner');
      var titleEl = document.getElementById('bc-active-title');
      var textEl = document.getElementById('bc-active-text');
      var iconEl = document.getElementById('bc-active-icon');

      if (!banner) return;
      if (bcast && bcast.systemBannerActive && bcast.systemBannerMessage) {
        banner.style.display = 'flex';
        if (textEl) textEl.textContent = bcast.systemBannerMessage;
        var lvl = bcast.systemBannerLevel || 'info';
        if (titleEl) titleEl.textContent = 'Active Banner (' + lvl.toUpperCase() + ')';
        if (iconEl) {
          if (lvl === 'warning') iconEl.textContent = '⚠️';
          else if (lvl === 'urgent') iconEl.textContent = '🚨';
          else if (lvl === 'success') iconEl.textContent = '✅';
          else iconEl.textContent = '📢';
        }
      } else {
        banner.style.display = 'none';
      }
    })
    .catch(function () { });
}

function sendBroadcast() {
  var msg = document.getElementById('bc-msg').value.trim();
  if (!msg) {
    showToast('⚠️ Announcement message is required');
    return;
  }

  var isForcedAll = document.getElementById('bc-role-all').checked;
  var targetRoles = [];
  if (isForcedAll) {
    targetRoles = ['all'];
  } else {
    if (document.getElementById('bc-role-teachers').checked) targetRoles.push('teacher');
    if (document.getElementById('bc-role-students').checked) targetRoles.push('student');
  }

  if (targetRoles.length === 0) {
    showToast('⚠️ Please select at least one target audience');
    return;
  }

  var level = document.getElementById('bc-level').value;
  var duration = parseInt(document.getElementById('bc-duration').value, 10) || 10;
  var sendBtn = document.getElementById('bc-send-btn');
  if (sendBtn) {
    sendBtn.disabled = true;
    sendBtn.textContent = '🚀 Dispatching Broadcast…';
  }

  var payload = {
    message: msg,
    level: level,
    targetRoles: targetRoles,
    isForcedAll: isForcedAll,
    popupDurationSec: duration
  };

  fetch('/api/system/broadcast/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + getToken()
    },
    body: JSON.stringify(payload)
  })
    .then(function (r) { return r.json(); })
    .then(function (res) {
      if (sendBtn) {
        sendBtn.disabled = false;
        sendBtn.textContent = '🚀 Dispatch Broadcast Now';
      }

      if (res && res.error) {
        showToast('❌ Dispatch failed: ' + res.error);
        return;
      }

      showToast('✅ Broadcast successfully dispatched to ' + (res.sentCount || 0) + ' recipient(s)');

      // Update Summary
      var sentEl = document.getElementById('bc-stat-sent');
      var failedEl = document.getElementById('bc-stat-failed');
      var listEl = document.getElementById('bc-recipient-ids');
      var listBox = document.getElementById('bc-recipient-list-box');

      if (sentEl) sentEl.textContent = res.sentCount || 0;
      if (failedEl) failedEl.textContent = res.failedCount || 0;

      if (listEl && res.sentUserIds && res.sentUserIds.length > 0) {
        listEl.textContent = res.sentUserIds.slice(0, 80).join(', ') + (res.sentUserIds.length > 80 ? ' … and ' + (res.sentUserIds.length - 80) + ' more' : '');
        if (listBox) listBox.style.display = 'block';
      }

      document.getElementById('bc-msg').value = '';
      loadActiveBroadcastStatus();
      loadBroadcastHistory();
    })
    .catch(function (err) {
      if (sendBtn) {
        sendBtn.disabled = false;
        sendBtn.textContent = '🚀 Dispatch Broadcast Now';
      }
      showToast('❌ Network error: ' + (err.message || ''));
    });
}

function clearActiveBroadcast() {
  fetch('/api/system/broadcast/clear', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + getToken()
    }
  })
    .then(function (r) { return r.json(); })
    .then(function (res) {
      if (res && res.success) {
        showToast('✅ Broadcast banner deactivated');
        var banner = document.getElementById('bc-active-banner');
        if (banner) banner.style.display = 'none';
      } else {
        showToast('❌ ' + (res.error || 'Deactivation failed'));
      }
    })
    .catch(function (err) {
      showToast('❌ ' + (err.message || 'Network error'));
    });
}

function loadBroadcastHistory() {
  var tbody = document.getElementById('bc-history-tbody');
  if (!tbody) return;

  fetch('/api/system/broadcast/history', {
    headers: { 'Authorization': 'Bearer ' + getToken() }
  })
    .then(function (r) { return r.json(); })
    .then(function (list) {
      if (!Array.isArray(list) || list.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:30px;color:var(--tmu);">📭 No broadcasts dispatched yet.</td></tr>';
        return;
      }

      var html = list.map(function (item) {
        var lvlBadge = '<span style="padding:2px 8px;border-radius:6px;font-size:10.5px;font-weight:700;font-family:\'JetBrains Mono\',monospace;';
        if (item.level === 'urgent') lvlBadge += 'background:#fef2f2;color:#dc2626;">🚨 URGENT</span>';
        else if (item.level === 'warning') lvlBadge += 'background:#fffbeb;color:#d97706;">⚠️ WARN</span>';
        else if (item.level === 'success') lvlBadge += 'background:#f0fdf4;color:#16a34a;">✅ SUCCESS</span>';
        else if (item.level === 'message') lvlBadge += 'background:#f5f3ff;color:#7c3aed;">💬 INBOX</span>';
        else lvlBadge += 'background:#eff6ff;color:#2563eb;">ℹ️ INFO</span>';

        var audienceStr = (item.isForcedAll || (item.targetRoles && item.targetRoles.includes('all'))) ? '🌐 All Users' : (item.targetRoles || []).join(', ');
        var sentStr = '<span style="color:#16a34a;font-weight:600;">' + (item.sentCount || 0) + ' sent</span>';
        if (item.failedCount > 0) sentStr += ' / <span style="color:#dc2626;font-weight:600;">' + item.failedCount + ' fail</span>';

        var authorName = item.dispatchedBy?.name || item.dispatchedBy?.username || 'Admin';
        var timeStr = new Date(item.dispatchedAt).toLocaleString('en-IN', {
          dateStyle: 'medium', timeStyle: 'short'
        });

        return '<tr style="border-bottom:1px solid var(--brl);">' +
          '<td style="padding:10px 14px;">' + lvlBadge + '</td>' +
          '<td style="padding:10px 14px;max-width:320px;font-size:12.5px;color:var(--td);word-break:break-word;">' + escapeHtml(item.message) + '</td>' +
          '<td style="padding:10px 14px;font-size:12px;color:var(--tmu);">' + escapeHtml(audienceStr) + '</td>' +
          '<td style="padding:10px 14px;font-size:12px;">' + sentStr + '</td>' +
          '<td style="padding:10px 14px;font-size:12px;color:var(--td);">' + escapeHtml(authorName) + '</td>' +
          '<td style="padding:10px 14px;font-size:11px;font-family:\'JetBrains Mono\',monospace;color:var(--tmu);">' + escapeHtml(timeStr) + '</td>' +
          '</tr>';
      }).join('');

      tbody.innerHTML = html;
    })
    .catch(function (err) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:30px;color:#dc2626;">❌ Error loading history: ' + escapeHtml(err.message || '') + '</td></tr>';
    });
}
