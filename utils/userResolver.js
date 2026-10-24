/**
 * Unified Identity Resolver
 *
 * Resolves an identifier (username or Smart Board Device ID) to its
 * identity type (human / board) and role, without requiring the client
 * to specify a role upfront.
 *
 * Resolution order:
 *   1. UserSchema  → human (student | teacher)
 *   2. SmartBoard  → board
 *   3. Not found   → { found: false }
 */

const M = require('../models');
const { getRoleModel } = require('../middleware/auth');

/**
 * Resolve an identifier to its identity type.
 *
 * @param {string} identifier - Username or Board Device ID
 * @returns {Promise<{
 *   found: boolean,
 *   identityType?: 'human' | 'board',
 *   role?: 'student' | 'teacher',
 *   shadowUser?: object,   // UserSchema document (human)
 *   roleModel?: object,    // Mongoose model for the role (human)
 *   boardDoc?: object,     // SmartBoard document (board)
 * }>}
 */
async function resolveIdentity(identifier, hintRole = null) {
  if (!identifier || typeof identifier !== 'string') {
    return { found: false };
  }

  const clean = identifier.toLowerCase().trim();

  // 1. Hardware device quick path: Smart Board device IDs begin with SB- or TR-
  const isLikelyBoard = clean.startsWith('sb-') || clean.startsWith('tr-');
  if (isLikelyBoard) {
    const boardDoc = await M.SmartBoard.findOne({
      deviceId: identifier.trim().toUpperCase(),
    }).lean().maxTimeMS(4000);
    if (boardDoc) {
      return {
        found: true,
        identityType: 'board',
        role: 'board',
        boardDoc,
      };
    }
  }

  // 2. Search UserSchema (human users) using fast .lean() point query
  let shadowUser = null;
  if (hintRole && ['student', 'teacher'].includes(hintRole)) {
    shadowUser = await M.User.findOne({ username: clean, role: hintRole }).lean().maxTimeMS(4000);
  }
  if (!shadowUser) {
    shadowUser = await M.User.findOne({ username: clean }).lean().maxTimeMS(4000);
  }

  if (shadowUser) {
    const roleModel = getRoleModel(shadowUser.role);
    return {
      found: true,
      identityType: 'human',
      role: shadowUser.role,
      shadowUser,
      roleModel,
    };
  }

  // 3. Fallback search Smart Board registry if not already checked
  if (!isLikelyBoard) {
    const boardDoc = await M.SmartBoard.findOne({
      deviceId: identifier.trim().toUpperCase(),
    }).lean().maxTimeMS(4000);
    if (boardDoc) {
      return {
        found: true,
        identityType: 'board',
        role: 'board',
        boardDoc,
      };
    }
  }

  // 4. Not found
  return { found: false };
}

module.exports = { resolveIdentity };
