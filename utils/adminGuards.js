/**
 * EAMS Admin Guards and Privilege Verification Helpers
 *
 * Implements database-backed security invariants:
 * - Last-admin guard: prevents deleting, deactivating, or demoting the last active Sudo Admin.
 */

const M = require('../models');
const { isSudoAdmin } = require('./access');

/**
 * Checks whether modifying/deleting/deactivating target user(s) would leave
 * the system with zero active Sudo Administrators.
 *
 * @param {Array<string>|string} targetIdentifiers - Array or single trackId / username / _id
 * @returns {Promise<{ allowed: boolean, error?: string }>}
 */
async function assertNotLastSudoAdmin(targetIdentifiers) {
  const targets = (Array.isArray(targetIdentifiers) ? targetIdentifiers : [targetIdentifiers])
    .filter(Boolean)
    .map(String);

  if (targets.length === 0) return { allowed: true };

  // Find all active teachers who are Sudo Admins
  const candidates = await M.Teacher.find({
    'specials.option': 'isAdmin',
    pageRights: {
      $elemMatch: {
        page: '*',
        accessRole: 'sudoAdmin',
        scope: 'institution',
        enabled: { $ne: false }
      }
    }
  }).select('_id trackId username specials pageRights').lean();

  const sudoCandidates = candidates.filter(isSudoAdmin);
  if (sudoCandidates.length === 0) {
    return { allowed: true };
  }

  const usernames = sudoCandidates.map(c => c.username).filter(Boolean);
  const activeUsers = await M.User.find({
    username: { $in: usernames },
    role: 'teacher',
    status: 'active'
  }).select('username trackId').lean();

  const activeUsernames = new Set(activeUsers.map(u => u.username));
  const activeSudoAdmins = sudoCandidates.filter(c => activeUsernames.has(c.username));

  // Determine which active Sudo Admins match the targetIdentifiers
  const remainingActiveSudos = activeSudoAdmins.filter(admin => {
    const idStr = String(admin._id);
    const trackStr = admin.trackId ? String(admin.trackId) : '';
    const userStr = admin.username ? String(admin.username) : '';
    return !targets.includes(idStr) && !targets.includes(trackStr) && !targets.includes(userStr);
  });

  if (remainingActiveSudos.length === 0) {
    return {
      allowed: false,
      error: 'Action rejected: Operation would leave the system without any active Sudo Administrators.'
    };
  }

  return { allowed: true };
}

module.exports = {
  assertNotLastSudoAdmin
};
