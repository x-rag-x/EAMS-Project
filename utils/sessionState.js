/**
 * Pure function to derive tile state for a class session.
 * Computes state, badge, label, and punctuality flags.
 *
 * @param {Object} session - ClassSession document or object
 * @param {string|Date} nowInput - Current time (HH:MM or Date)
 * @param {Object} [settings] - Controller settings
 * @returns {Object} { state, label, icon, badgeClass, minutesRemaining, minutesLate, flags }
 */
function deriveSessionState(session, nowInput = new Date(), settings = {}) {
  const flags = Array.isArray(session.flags) ? [...session.flags] : [];
  const deadlineMin = Number(settings.attendanceDeadlineMin) || 10;

  // Resolve current HH:MM string in IST
  let nowHM = '';
  if (typeof nowInput === 'string' && nowInput.includes(':') && nowInput.length === 5) {
    nowHM = nowInput;
  } else {
    const d = new Date(nowInput);
    const parts = new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).formatToParts(d);
    const hour = parts.find(p => p.type === 'hour')?.value || '00';
    const min = parts.find(p => p.type === 'minute')?.value || '00';
    nowHM = `${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;
  }

  // Convert HH:MM to minutes from midnight
  const toMinutes = hm => {
    if (!hm) return 0;
    const [h, m] = hm.split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  };

  const nowMinutes = toMinutes(nowHM);
  const startMinutes = toMinutes(session.start);
  const endMinutes = toMinutes(session.end);

  // Check-in flags computation
  if (session.attendance?.savedAt && !session.startClass?.at) {
    if (!flags.includes('no_start_tap')) flags.push('no_start_tap');
  }
  if (session.startClass?.geo === 'outside') {
    if (!flags.includes('outside_campus')) flags.push('outside_campus');
  } else if (session.startClass?.geo === 'denied') {
    if (!flags.includes('location_denied')) flags.push('location_denied');
  }

  // 1. Status Overrides (Cancelled / Holiday / Exam)
  if (session.status === 'cancelled') {
    return {
      state: 'cancelled',
      label: 'Cancelled',
      icon: '⚫',
      color: '#64748b',
      badgeClass: 'badge-dark',
      requiresAttention: false,
      isOverdue: false,
      subtext: 'Cancelled session',
      flags
    };
  }
  if (session.status === 'holiday') {
    return {
      state: 'holiday',
      label: 'Holiday',
      icon: '⚫',
      color: '#64748b',
      badgeClass: 'badge-secondary',
      requiresAttention: false,
      isOverdue: false,
      subtext: 'Academic holiday',
      flags
    };
  }
  if (session.status === 'exam' || session.slotType === 'exam') {
    return {
      state: 'exam',
      label: 'Exam',
      icon: '📝',
      color: '#0284c7',
      badgeClass: 'badge-info',
      requiresAttention: false,
      isOverdue: false,
      subtext: 'Examination slot',
      flags
    };
  }

  // 2. Non-teaching slot (Library, Sports, Placement Training, Seminar)
  if (['library', 'sports', 'training', 'seminar'].includes(session.slotType)) {
    const title = session.slotType.charAt(0).toUpperCase() + session.slotType.slice(1);
    return {
      state: 'non_teaching',
      label: `${title} (${session.room || 'Campus'})`,
      icon: '📚',
      color: '#64748b',
      badgeClass: 'badge-secondary',
      requiresAttention: false,
      isOverdue: false,
      subtext: 'Non-teaching activity',
      flags
    };
  }

  // 3. Marked states
  if (session.attendance?.savedAt) {
    let isLate = session.attendance.onTime === false;
    let minutesAfter = session.attendance.minutesAfterStart;

    if (session.attendance.onTime === undefined && minutesAfter == null && session.attendance.savedAt && session.start) {
      const savedDate = new Date(session.attendance.savedAt);
      const savedParts = new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      }).formatToParts(savedDate);
      const sH = savedParts.find(p => p.type === 'hour')?.value || '00';
      const sM = savedParts.find(p => p.type === 'minute')?.value || '00';
      const savedMin = toMinutes(`${sH}:${sM}`);
      minutesAfter = Math.max(0, savedMin - startMinutes);
      isLate = minutesAfter > deadlineMin;
    }

    if (isLate) {
      return {
        state: 'marked_late',
        label: `Marked ${minutesAfter || 0}m late`,
        icon: '🟡',
        color: '#eab308',
        badgeClass: 'badge-warning',
        markedAt: session.attendance.savedAt,
        requiresAttention: false,
        isOverdue: false,
        subtext: `Marked late (+${minutesAfter || 0}m)`,
        strength: `${session.attendance.present || 0}/${session.attendance.total || 0} present`,
        flags
      };
    }

    return {
      state: 'marked_on_time',
      label: 'Marked on time',
      icon: '🟢',
      color: '#16a34a',
      badgeClass: 'badge-success',
      markedAt: session.attendance.savedAt,
      requiresAttention: false,
      isOverdue: false,
      subtext: 'Attendance saved on time',
      strength: `${session.attendance.present || 0}/${session.attendance.total || 0} present`,
      flags
    };
  }

  // 4. Leave & Substitution States
  if (session.leavePendingPrincipal) {
    return {
      state: 'leave_pending_principal',
      label: 'Leave awaiting Principal',
      icon: '⏳',
      color: '#d97706',
      badgeClass: 'badge-warning',
      requiresAttention: true,
      isOverdue: false,
      subtext: 'Teacher applied for leave · Awaiting Principal',
      flags
    };
  }

  if (session.source === 'substitution' && session.actualTeacher?.trackId) {
    const isRunning = nowMinutes >= startMinutes && nowMinutes <= endMinutes;
    if (isRunning) {
      const minutesSinceStart = nowMinutes - startMinutes;
      if (minutesSinceStart > deadlineMin) {
        return {
          state: 'overdue',
          label: `Substitute: Not marked (${minutesSinceStart - deadlineMin}m late)`,
          icon: '🔴',
          color: '#ef4444',
          badgeClass: 'badge-danger',
          requiresAttention: true,
          isOverdue: true,
          minutesLate: minutesSinceStart - deadlineMin,
          subtext: `Substitute class not marked (${minutesSinceStart - deadlineMin}m late)`,
          flags
        };
      }
      return {
        state: 'marking_window',
        label: `Substitute (${deadlineMin - minutesSinceStart}m left)`,
        icon: '🟣',
        color: '#a855f7',
        badgeClass: 'badge-purple',
        requiresAttention: false,
        isOverdue: false,
        minutesRemaining: deadlineMin - minutesSinceStart,
        subtext: `Substitute active (${deadlineMin - minutesSinceStart}m left)`,
        flags
      };
    }
    return {
      state: 'substitute',
      label: 'Substitute Assigned',
      icon: '🟣',
      color: '#a855f7',
      badgeClass: 'badge-purple',
      requiresAttention: false,
      isOverdue: false,
      subtext: `${session.actualTeacher.name || 'Substitute'} taking class`,
      flags
    };
  }

  if (session.status === 'needs_substitute' || (!session.actualTeacher?.trackId && session.source === 'substitution')) {
    return {
      state: 'needs_substitute',
      label: 'Teacher on leave · No substitute',
      icon: '🔴',
      color: '#dc2626',
      badgeClass: 'badge-danger',
      requiresAttention: true,
      isOverdue: false,
      subtext: 'Teacher on leave · Unresolved slot',
      flags
    };
  }

  // 5. Time-based Session Progress
  if (nowMinutes < startMinutes) {
    const minutesUntilStart = startMinutes - nowMinutes;
    if (minutesUntilStart <= 10) {
      return {
        state: 'upcoming',
        label: `Starts in ${minutesUntilStart}m`,
        icon: '🔵',
        color: '#3b82f6',
        badgeClass: 'badge-info',
        requiresAttention: false,
        isOverdue: false,
        minutesUntilStart,
        subtext: `Starts in ${minutesUntilStart}m`,
        flags
      };
    }
    return {
      state: 'scheduled',
      label: `Upcoming at ${session.start}`,
      icon: '⚪',
      color: '#64748b',
      badgeClass: 'badge-light',
      requiresAttention: false,
      isOverdue: false,
      subtext: `Scheduled at ${session.start}`,
      flags
    };
  }

  if (nowMinutes >= startMinutes && nowMinutes <= endMinutes) {
    const minutesElapsed = nowMinutes - startMinutes;

    if (minutesElapsed <= deadlineMin) {
      return {
        state: 'marking_window',
        label: `${deadlineMin - minutesElapsed}m left to mark`,
        icon: '🟠',
        color: '#f97316',
        badgeClass: 'badge-warning',
        requiresAttention: false,
        isOverdue: false,
        minutesRemaining: deadlineMin - minutesElapsed,
        subtext: `${deadlineMin - minutesElapsed}m left in 10-min window`,
        flags
      };
    }

    // Past 10 min window without saved attendance -> Overdue
    const minutesLate = minutesElapsed - deadlineMin;
    return {
      state: 'overdue',
      label: `Not marked · ${minutesLate}m late`,
      icon: '🔴',
      color: '#ef4444',
      badgeClass: 'badge-danger',
      requiresAttention: true,
      isOverdue: true,
      minutesLate,
      subtext: `Attendance not saved (${minutesLate}m late)`,
      flags
    };
  }

  // Past period end
  return {
    state: 'unmarked',
    label: 'Period ended unmarked',
    icon: '🔒',
    color: '#475569',
    badgeClass: 'badge-dark',
    requiresAttention: true,
    isOverdue: true,
    subtext: 'Locked unmarked',
    flags
  };
}

module.exports = {
  deriveSessionState
};
