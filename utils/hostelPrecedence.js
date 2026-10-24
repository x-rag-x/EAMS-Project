/**
 * Resolves precedence when sources conflict in Hostel Attendance (§6.2 of hostel_plan.md).
 *
 * Priority hierarchy:
 * 1. Auto (approved pass + checked out, medical, away on approved OD) -> Locked
 * 2. Warden marking / verification
 * 3. Student "I'm back" after curfew -> Late
 * 4. QR self check-in -> Present
 * 5. Unmarked at close -> Absent (unverified)
 */

const SOURCE_PRIORITY = {
  'auto-leave':   1,
  'auto-medical': 1,
  'auto-od':      1,
  'warden':       2,
  'late-return':  3,
  'qr':           4,
  'system':       5,
};

function canOverrideStatus(existingAttendance, incomingMethod) {
  if (!existingAttendance) return true;
  if (existingAttendance.locked && !incomingMethod.startsWith('auto-') && incomingMethod !== 'warden') {
    return false;
  }

  const existingPriority = SOURCE_PRIORITY[existingAttendance.method] || 5;
  const incomingPriority = SOURCE_PRIORITY[incomingMethod] || 5;

  // Lower number = higher priority
  return incomingPriority <= existingPriority;
}

module.exports = {
  SOURCE_PRIORITY,
  canOverrideStatus,
};
