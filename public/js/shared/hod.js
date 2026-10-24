/**
 * EAMS Shared HOD Module (public/js/shared/hod.js)
 * Used identically by teacher.html (HOD portal) and controller.html.
 * Provides unified API callers, leave approval workflows, and badge sync.
 */

(function (window) {
  'use strict';

  const HodShared = {
    /**
     * Get active authentication token
     */
    getToken: function () {
      return sessionStorage.getItem('eams_token') || '';
    },

    /**
     * Common fetch wrapper with Authorization header
     */
    apiFetch: async function (url, options = {}) {
      const headers = {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + HodShared.getToken(),
        ...(options.headers || {})
      };
      const res = await fetch(url, { ...options, headers });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || data.message || `Request failed (${res.status})`);
      }
      return data;
    },

    /**
     * Fetch controller identity and active scope
     */
    fetchMyScope: async function (asRole = null, dept = null) {
      const params = new URLSearchParams();
      if (asRole) params.append('as', asRole);
      if (dept) params.append('dept', dept);
      const query = params.toString() ? '?' + params.toString() : '';
      return await HodShared.apiFetch('/api/controller/me' + query);
    },

    /**
     * Fetch pending items waiting for HOD approval
     */
    fetchPendingApprovals: async function (deptCode) {
      const query = deptCode ? `?dept=${encodeURIComponent(deptCode)}` : '';
      return await HodShared.apiFetch('/api/controller/inbox' + query);
    },

    /**
     * Permit / Recommend a faculty leave request
     */
    permitFacultyLeave: async function (leaveId, comment = '') {
      return await HodShared.apiFetch(`/api/leave/faculty/${leaveId}/hod-permit`, {
        method: 'POST',
        body: JSON.stringify({ comment })
      });
    },

    /**
     * Reject a faculty leave request with required reason
     */
    rejectFacultyLeave: async function (leaveId, reason) {
      if (!reason || !reason.trim()) {
        throw new Error('A rejection reason is required');
      }
      return await HodShared.apiFetch(`/api/leave/faculty/${leaveId}/hod-reject`, {
        method: 'POST',
        body: JSON.stringify({ reason: reason.trim() })
      });
    },

    /**
     * Return a faculty leave request for correction
     */
    returnFacultyLeave: async function (leaveId, note) {
      return await HodShared.apiFetch(`/api/leave/faculty/${leaveId}/hod-return`, {
        method: 'POST',
        body: JSON.stringify({ note: note ? note.trim() : '' })
      });
    },

    /**
     * HOD Direct assignment of a substitute teacher to a slot
     */
    assignSubstitute: async function (leaveId, slotId, substituteTrackId, reason = '') {
      return await HodShared.apiFetch('/api/substitution/direct-assign', {
        method: 'POST',
        body: JSON.stringify({
          leaveId,
          slotId,
          substituteTrackId,
          reason
        })
      });
    },

    /**
     * Approve or reject a teacher's attendance unlock request
     */
    decideUnlockRequest: async function (requestId, decision, note = '') {
      return await HodShared.apiFetch(`/api/controller/unlock-requests/${requestId}/${decision}`, {
        method: 'POST',
        body: JSON.stringify({ note })
      });
    },

    /**
     * Format a leave status badge HTML string
     */
    renderStatusBadge: function (status) {
      const s = String(status || '').toLowerCase();
      let colorClass = 'badge-secondary';
      let dotColor = 'gray';

      if (s === 'approved' || s === 'permitted') {
        colorClass = 'badge-success';
        dotColor = 'green';
      } else if (s === 'pending') {
        colorClass = 'badge-warning';
        dotColor = 'amber';
      } else if (s === 'rejected') {
        colorClass = 'badge-danger';
        dotColor = 'red';
      } else if (s === 'returned') {
        colorClass = 'badge-info';
        dotColor = 'blue';
      }

      return `<span class="badge ${colorClass}"><span class="status-dot ${dotColor}"></span>${status}</span>`;
    }
  };

  window.HodShared = HodShared;

})(typeof window !== 'undefined' ? window : this);
