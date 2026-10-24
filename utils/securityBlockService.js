/**
 * EAMS Security Block Service
 *
 * Multi-dimensional login abuse prevention.
 * Tracks failed login attempts across four scopes and creates
 * time-limited blocks when configurable thresholds are exceeded.
 *
 * Block scopes:
 *   account_device  →  strict (3 failures)
 *   account         →  strict/moderate (5 failures)
 *   device          →  moderate (10 failures)
 *   ip              →  lenient (50 failures)
 *
 * Thresholds are read from EAMS Settings (key: 'security') so admins
 * can tune them without code changes.
 */

const M = require('../models');
const { getSettings } = require('./settingsCache');

// ── Default thresholds (overridable via Settings → security) ──

const DEFAULTS = {
  accountDeviceThreshold: 3,
  accountDeviceLockoutMins: 15,

  accountThreshold: 5,
  accountLockoutMins: 30,

  deviceThreshold: 10,
  deviceLockoutMins: 30,

  ipThreshold: 50,
  ipLockoutMins: 60,

  // Credential-stuffing: IP attacking many distinct usernames
  ipDistinctUsernameThreshold: 20,
  ipDistinctUsernameLockoutMins: 120,
};

/**
 * Load thresholds from EAMS settings cache, falling back to defaults.
 */
async function getThresholds() {
  try {
    const settingsMap = await getSettings(['security']);
    const sec = settingsMap.security || {};
    return {
      accountDeviceThreshold:         sec.accountDeviceThreshold         ?? DEFAULTS.accountDeviceThreshold,
      accountDeviceLockoutMins:       sec.accountDeviceLockoutMins       ?? DEFAULTS.accountDeviceLockoutMins,
      accountThreshold:               sec.accountThreshold               ?? DEFAULTS.accountThreshold,
      accountLockoutMins:             sec.accountLockoutMins             ?? DEFAULTS.accountLockoutMins,
      deviceThreshold:                sec.deviceThreshold                ?? DEFAULTS.deviceThreshold,
      deviceLockoutMins:              sec.deviceLockoutMins              ?? DEFAULTS.deviceLockoutMins,
      ipThreshold:                    sec.ipThreshold                    ?? DEFAULTS.ipThreshold,
      ipLockoutMins:                  sec.ipLockoutMins                  ?? DEFAULTS.ipLockoutMins,
      ipDistinctUsernameThreshold:    sec.ipDistinctUsernameThreshold    ?? DEFAULTS.ipDistinctUsernameThreshold,
      ipDistinctUsernameLockoutMins:  sec.ipDistinctUsernameLockoutMins  ?? DEFAULTS.ipDistinctUsernameLockoutMins,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

/**
 * Build the composite identifier for a given block scope.
 */
function buildIdentifier(blockType, { username, deviceId, ip }) {
  switch (blockType) {
    case 'account_device': return `${username}::${deviceId}`;
    case 'account':        return username;
    case 'device':         return deviceId;
    case 'ip':             return ip;
    default:               return '';
  }
}

/**
 * Check if any active security block applies to the given login attempt.
 *
 * @param {string} username
 * @param {string} deviceId
 * @param {string} ip
 * @returns {Promise<{ blocked: boolean, block?: object, message?: string }>}
 */
async function checkBlock(username, deviceId, ip) {
  const now = new Date();
  const identifiers = [];

  if (username && deviceId) {
    identifiers.push({ blockType: 'account_device', identifier: `${username}::${deviceId}` });
  }
  if (username) {
    identifiers.push({ blockType: 'account', identifier: username });
  }
  if (deviceId) {
    identifiers.push({ blockType: 'device', identifier: deviceId });
  }
  if (ip) {
    identifiers.push({ blockType: 'ip', identifier: ip });
  }

  if (!identifiers.length) return { blocked: false };

  const orClauses = identifiers.map(({ blockType, identifier }) => ({
    blockType,
    identifier,
    active: true,
    expiresAt: { $gt: now },
  }));

  const block = await M.SecurityBlock.findOne({ $or: orClauses }).lean();
  if (block) {
    const remaining = Math.ceil((new Date(block.expiresAt) - now) / 60000);
    return {
      blocked: true,
      block,
      message: `Too many failed login attempts. Try again in ${remaining} minute(s).`,
    };
  }

  return { blocked: false };
}

/**
 * Record a failed login attempt and create security blocks if thresholds are exceeded.
 *
 * @param {string} username
 * @param {string} deviceId
 * @param {string} ip
 * @returns {Promise<{ newBlocks: string[] }>}  List of new block types created
 */
async function recordFailedAttempt(username, deviceId, ip) {
  const thresholds = await getThresholds();
  const now = new Date();
  const newBlocks = [];

  // Helper: increment or create a SecurityBlock tracking doc
  async function incrementScope(blockType, extraFields = {}) {
    const identifier = buildIdentifier(blockType, { username, deviceId, ip });
    if (!identifier) return;

    // Check if there's already an active block
    const existingBlock = await M.SecurityBlock.findOne({
      blockType, identifier, active: true, expiresAt: { $gt: now },
    });
    if (existingBlock) return; // Already blocked

    // Increment the failure counter using a "tracking" doc (active: false until threshold)
    const tracker = await M.SecurityBlock.findOneAndUpdate(
      { blockType, identifier, active: false },
      {
        $inc: { failedCount: 1 },
        $set: { ...extraFields },
        $setOnInsert: {
          blockType,
          identifier,
          blockedAt: now,
          expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000), // tracker expires in 24h
          createdBy: 'system',
        },
      },
      { upsert: true, returnDocument: 'after' }
    );

    // Check thresholds
    let threshold, lockoutMins;
    switch (blockType) {
      case 'account_device':
        threshold = thresholds.accountDeviceThreshold;
        lockoutMins = thresholds.accountDeviceLockoutMins;
        break;
      case 'account':
        threshold = thresholds.accountThreshold;
        lockoutMins = thresholds.accountLockoutMins;
        break;
      case 'device':
        threshold = thresholds.deviceThreshold;
        lockoutMins = thresholds.deviceLockoutMins;
        break;
      case 'ip':
        threshold = thresholds.ipThreshold;
        lockoutMins = thresholds.ipLockoutMins;
        break;
    }

    if (tracker.failedCount >= threshold) {
      // Activate the block
      await M.SecurityBlock.updateOne(
        { _id: tracker._id },
        {
          $set: {
            active: true,
            blockedAt: now,
            expiresAt: new Date(now.getTime() + lockoutMins * 60 * 1000),
            reason: `Exceeded ${threshold} failed attempts (${blockType})`,
          },
        }
      );
      newBlocks.push(blockType);
    }
  }

  // Increment all applicable scopes in parallel
  const tasks = [];
  if (username && deviceId) {
    tasks.push(incrementScope('account_device', { username, deviceId, ip }));
  }
  if (username) {
    tasks.push(incrementScope('account', { username, ip }));
  }
  if (deviceId) {
    tasks.push(incrementScope('device', { deviceId, ip }));
  }
  if (ip) {
    tasks.push(incrementScope('ip', { ip, username }));
  }

  await Promise.allSettled(tasks);

  return { newBlocks };
}

/**
 * Clear security blocks (admin-initiated unblock).
 *
 * @param {string} blockType - 'account' | 'device' | 'ip' | 'account_device' | 'all'
 * @param {string} identifier - The identifier to unblock
 */
async function clearBlock(blockType, identifier) {
  if (blockType === 'all') {
    await M.SecurityBlock.updateMany(
      { $or: [{ username: identifier }, { ip: identifier }, { deviceId: identifier }], active: true },
      { $set: { active: false } }
    );
  } else {
    await M.SecurityBlock.updateMany(
      { blockType, identifier, active: true },
      { $set: { active: false } }
    );
  }
}

/**
 * Clear all blocks for a specific username (e.g. after successful login or admin unlock).
 *
 * @param {string} username
 */
async function clearBlocksForUser(username) {
  if (!username) return;
  await M.SecurityBlock.updateMany(
    { username, active: true },
    { $set: { active: false } }
  );
}

module.exports = {
  checkBlock,
  recordFailedAttempt,
  clearBlock,
  clearBlocksForUser,
  getThresholds,
};
