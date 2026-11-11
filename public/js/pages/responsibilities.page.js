let allResponsibilities = [];
let allDepartments = [];
let allTeachers = [];
let selectedResponsibility = null;

document.addEventListener('DOMContentLoaded', async () => {
  await Promise.all([
    loadDepartments(),
    loadTeachers(),
    loadResponsibilities()
  ]);
});

async function loadDepartments() {
  try {
    const res = await apiCall('GET', '/departments');
    allDepartments = Array.isArray(res) ? res : (res?.data || []);
    const sel = document.getElementById('resp-dept-input');
    if (sel) {
      sel.innerHTML = '<option value="">Select Department</option>' +
        allDepartments.map(d => `<option value="${escapeHtml(d._id)}">${escapeHtml(d.name || d.code)}</option>`).join('');
    }
  } catch (err) {
    console.error('Failed to load departments', err);
  }
}

async function loadTeachers() {
  try {
    const res = await apiCall('GET', '/teachers');
    allTeachers = Array.isArray(res) ? res : (res?.data || []);
  } catch (err) {
    console.error('Failed to load teachers', err);
  }
}

async function loadResponsibilities() {
  try {
    const res = await apiCall('GET', '/responsibilities');
    allResponsibilities = res?.data || (Array.isArray(res) ? res : []);
    filterResponsibilities();
    if (selectedResponsibility) {
      const refreshed = allResponsibilities.find(r => r._id === selectedResponsibility._id);
      if (refreshed) selectResponsibility(refreshed);
    }
  } catch (err) {
    toast('Error loading responsibilities: ' + err.message, 'error');
  }
}

function filterResponsibilities() {
  const query = (document.getElementById('resp-search')?.value || '').toLowerCase().trim();
  const scopeFilter = document.getElementById('resp-filter-scope')?.value || 'all';

  const filtered = allResponsibilities.filter(r => {
    if (scopeFilter !== 'all' && r.scope !== scopeFilter) return false;
    if (query) {
      const nameMatch = (r.name || '').toLowerCase().includes(query);
      const deptMatch = (r.deptName || '').toLowerCase().includes(query);
      const teacherMatch = (r.assignedTeachers || []).some(t =>
        (t.fullName || t.name || '').toLowerCase().includes(query) ||
        (t.employeeNo || '').toLowerCase().includes(query)
      );
      return nameMatch || deptMatch || teacherMatch;
    }
    return true;
  });

  const countEl = document.getElementById('resp-count');
  if (countEl) countEl.textContent = filtered.length;

  renderResponsibilitiesList(filtered);
}

function renderResponsibilitiesList(list) {
  const container = document.getElementById('resp-list-container');
  if (!container) return;

  if (!list.length) {
    container.innerHTML = `
      <div style="text-align:center;padding:40px;background:#fff;border-radius:12px;border:1px dashed var(--br,#e2e8f0);color:var(--tmu,#64748b);">
        No responsibilities found. Click "+ Add Responsibility" above to create one.
      </div>`;
    return;
  }

  container.innerHTML = list.map(r => {
    const isSel = selectedResponsibility && selectedResponsibility._id === r._id;
    const isDept = r.scope === 'department';
    const deptBadge = isDept && (r.deptId?.code || r.deptId?.name || r.deptName)
      ? `<span class="pill" style="font-size:11px;background:#fef3c7;color:#b45309;">${escapeHtml(r.deptId?.code || r.deptId?.name || r.deptName)}</span>`
      : '';
    const teacherCount = (r.assignedTeachers || []).length;

    return `
      <div class="resp-card ${isSel ? 'active' : ''}" onclick="selectResponsibilityById('${r._id}')" style="cursor:pointer;">
        <div class="resp-header">
          <div>
            <div class="resp-title">${escapeHtml(r.name)}</div>
            <div class="resp-meta" style="margin-top:4px;">
              <span class="resp-scope-badge scope-${r.scope}">${r.scope}</span>
              ${deptBadge}
              <span class="resp-load-badge">⚡ -${r.workloadPeriodsPerWeek} periods/wk</span>
            </div>
          </div>
          <div style="display:flex;gap:4px;" onclick="event.stopPropagation()">
            <button class="btn-out" style="padding:3px 8px;font-size:11px;" onclick="openEditRespModal('${r._id}')">Edit</button>
            <button class="btn-out" style="padding:3px 8px;font-size:11px;color:#ef4444;border-color:rgba(239,68,68,0.3);" onclick="deleteResponsibility('${r._id}')">Delete</button>
          </div>
        </div>
        <div style="font-size:12px;color:var(--tmu,#64748b);display:flex;align-items:center;justify-content:space-between;margin-top:8px;">
          <span>${teacherCount} Faculty Member${teacherCount === 1 ? '' : 's'} Assigned</span>
          <span style="font-weight:600;color:var(--pri,#2563eb);">Manage &rarr;</span>
        </div>
      </div>
    `;
  }).join('');
}

function selectResponsibilityById(id) {
  const r = allResponsibilities.find(x => x._id === id);
  if (r) selectResponsibility(r);
}

function selectResponsibility(r) {
  selectedResponsibility = r;
  filterResponsibilities(); // update active highlight

  const container = document.getElementById('resp-detail-card');
  if (!container) return;

  const assigned = r.assignedTeachers || [];
  const assignedIds = new Set(assigned.map(t => String(t._id || t)));

  // Available teachers to assign
  const availableTeachers = allTeachers.filter(t => !assignedIds.has(String(t._id)));

  container.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:1px solid var(--br,#e2e8f0);padding-bottom:16px;margin-bottom:16px;">
      <div>
        <span class="resp-scope-badge scope-${r.scope}">${r.scope} Scope</span>
        <h2 style="font-size:20px;font-weight:700;margin:6px 0 4px 0;">${escapeHtml(r.name)}</h2>
        <div style="font-size:13px;color:var(--tmu,#64748b);">
          ${r.scope === 'department' ? `Scoped to: <b>${escapeHtml(r.deptId?.name || r.deptName || 'Department')}</b> &bull; ` : ''}
          Workload Deduction: <b style="color:#1d4ed8;">${r.workloadPeriodsPerWeek} Periods / Week</b>
        </div>
      </div>
      <button class="btn-out btn-sm" onclick="openEditRespModal('${r._id}')"><re-icon icon="edit" size="12"></re-icon> Edit Settings</button>
    </div>

    <!-- Assigned Faculty List -->
    <div style="margin-bottom:24px;">
      <h3 style="font-size:14px;font-weight:700;margin-bottom:8px;">
        Assigned Faculty Members (${assigned.length})
      </h3>
      ${!assigned.length
        ? '<div style="font-size:13px;color:var(--tmu,#64748b);padding:14px;background:#f8fafc;border-radius:8px;">No faculty members currently assigned to this responsibility.</div>'
        : `<div class="assigned-chips">
            ${assigned.map(t => `
              <div class="t-chip">
                <span><b>${escapeHtml(t.fullName || t.name)}</b> <span style="color:#64748b;font-size:11px;">(${escapeHtml(t.department || t.employeeNo || 'Faculty')})</span></span>
                <span class="t-chip-rm" onclick="unassignTeacher('${r._id}', '${t._id}')" title="Unassign faculty member">&times;</span>
              </div>
            `).join('')}
          </div>`
      }
    </div>

    <!-- Assign Faculty Picker -->
    <div style="background:#f8fafc;border:1px solid var(--br,#e2e8f0);border-radius:10px;padding:16px;">
      <h4 style="font-size:13px;font-weight:700;margin:0 0 10px 0;">Assign Faculty to this Responsibility</h4>
      <div style="display:flex;gap:10px;flex-wrap:wrap;">
        <select id="assign-teacher-select" class="fc2" style="flex:1;min-width:220px;font-size:13px;">
          <option value="">Select Faculty Member…</option>
          ${availableTeachers.map(t => `
            <option value="${escapeHtml(t._id)}">${escapeHtml(t.fullName || t.name)} (${escapeHtml(t.department || t.dept || '')} - ${escapeHtml(t.designation || 'Faculty')})</option>
          `).join('')}
        </select>
        <button class="btn-pri" onclick="assignSelectedTeacher('${r._id}')">Assign Faculty</button>
      </div>
    </div>
  `;
}

function toggleDeptSelect(val) {
  const wrap = document.getElementById('resp-dept-wrap');
  if (wrap) wrap.style.display = val === 'department' ? 'block' : 'none';
}

function openAddRespModal() {
  document.getElementById('modal-resp-title').textContent = 'Add Responsibility';
  document.getElementById('modal-resp-id').value = '';
  document.getElementById('resp-name-input').value = '';
  document.getElementById('resp-scope-input').value = 'institute';
  document.getElementById('resp-workload-input').value = '4';
  toggleDeptSelect('institute');
  openModal_('modal-resp');
}

function openEditRespModal(id) {
  const r = allResponsibilities.find(x => x._id === id);
  if (!r) return;
  document.getElementById('modal-resp-title').textContent = 'Edit Responsibility';
  document.getElementById('modal-resp-id').value = r._id;
  document.getElementById('resp-name-input').value = r.name || '';
  document.getElementById('resp-scope-input').value = r.scope || 'institute';
  document.getElementById('resp-workload-input').value = r.workloadPeriodsPerWeek ?? 4;
  toggleDeptSelect(r.scope);
  if (r.scope === 'department' && document.getElementById('resp-dept-input')) {
    document.getElementById('resp-dept-input').value = r.deptId?._id || r.deptId || '';
  }
  openModal_('modal-resp');
}

async function saveResponsibility() {
  const id = document.getElementById('modal-resp-id').value;
  const name = document.getElementById('resp-name-input').value.trim();
  const scope = document.getElementById('resp-scope-input').value;
  const workloadPeriodsPerWeek = Number(document.getElementById('resp-workload-input').value);
  const deptId = scope === 'department' ? document.getElementById('resp-dept-input').value : null;

  if (!name) return toast('Name is required', 'warn');
  if (isNaN(workloadPeriodsPerWeek) || workloadPeriodsPerWeek < 0) return toast('Valid workload required', 'warn');
  if (scope === 'department' && !deptId) return toast('Department is required for department-scoped responsibility', 'warn');

  const deptObj = allDepartments.find(d => String(d._id) === String(deptId));
  const deptName = deptObj ? (deptObj.name || deptObj.code) : '';

  const payload = { name, scope, workloadPeriodsPerWeek, deptId, deptName };

  try {
    if (id) {
      await apiCall('PUT', `/responsibilities/${id}`, payload);
      toast('Responsibility updated successfully', 'success');
    } else {
      await apiCall('POST', '/responsibilities', payload);
      toast('Responsibility created successfully', 'success');
    }
    closeModalBg('modal-resp');
    await loadResponsibilities();
  } catch (err) {
    toast('Error: ' + err.message, 'error');
  }
}

async function deleteResponsibility(id) {
  if (!confirm('Are you sure you want to delete this responsibility? It will be removed from all assigned faculty members.')) return;
  try {
    await apiCall('DELETE', `/responsibilities/${id}`);
    toast('Responsibility deleted', 'success');
    if (selectedResponsibility && selectedResponsibility._id === id) {
      selectedResponsibility = null;
      document.getElementById('resp-detail-card').innerHTML = `
        <div style="text-align:center;padding:60px 20px;color:var(--tmu,#64748b);">
          <div style="font-size:32px;margin-bottom:8px;">📋</div>
          <div style="font-weight:600;">Select a responsibility from the left to view assignments and attach faculty members.</div>
        </div>`;
    }
    await loadResponsibilities();
  } catch (err) {
    toast('Error: ' + err.message, 'error');
  }
}

async function assignSelectedTeacher(respId) {
  const sel = document.getElementById('assign-teacher-select');
  const teacherId = sel?.value;
  if (!teacherId) return toast('Please select a faculty member', 'warn');

  try {
    await apiCall('POST', `/responsibilities/${respId}/assign`, { teacherIds: [teacherId] });
    toast('Faculty member assigned successfully', 'success');
    await loadResponsibilities();
  } catch (err) {
    toast('Error: ' + err.message, 'error');
  }
}

async function unassignTeacher(respId, teacherId) {
  if (!confirm('Remove this faculty member from this responsibility?')) return;
  try {
    await apiCall('POST', `/responsibilities/${respId}/unassign`, { teacherId });
    toast('Faculty member unassigned', 'success');
    await loadResponsibilities();
  } catch (err) {
    toast('Error: ' + err.message, 'error');
  }
}
