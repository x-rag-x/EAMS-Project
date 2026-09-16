const M = require('../models');
const { DEFAULT_SETTINGS_MAP } = require('../config/defaultSettings');

const cache = new Map();
const CACHE_TTL_MS = 60 * 1000; // 60-second TTL

/**
 * Retrieve domain setting with in-memory caching.
 * @param {string} key - The setting key (e.g. 'security', 'pages', 'advanced', 'maintenance')
 * @returns {Promise<Object>} Setting value object merged with defaults
 */
async function getSetting(key) {
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const defaultValue = DEFAULT_SETTINGS_MAP[key]?.value || {};

  // If Mongoose is not connected, immediately return cached or default
  if (!M.Settings || !M.Settings.db || M.Settings.db.readyState !== 1) {
    cache.set(key, { value: defaultValue, expiresAt: now + 5000 });
    return cached ? cached.value : defaultValue;
  }

  try {
    const doc = await M.Settings.findOne({ key }).lean();
    const mergedValue = { ...defaultValue, ...(doc?.value || {}) };
    cache.set(key, { value: mergedValue, expiresAt: now + CACHE_TTL_MS });
    return mergedValue;
  } catch (err) {
    cache.set(key, { value: defaultValue, expiresAt: now + 5000 });
    if (cached) return cached.value;
    return defaultValue;
  }
}

/**
 * Retrieve multiple domain settings concurrently with in-memory caching.
 * @param {string[]} keys - Array of setting keys
 * @returns {Promise<Object>} Map of key -> setting value object
 */
async function getSettings(keys = []) {
  const result = {};
  const missingKeys = [];
  const now = Date.now();

  for (const key of keys) {
    const cached = cache.get(key);
    if (cached && cached.expiresAt > now) {
      result[key] = cached.value;
    } else {
      missingKeys.push(key);
    }
  }

  if (missingKeys.length > 0) {
    const dbConnected = M.Settings && M.Settings.db && M.Settings.db.readyState === 1;
    if (!dbConnected) {
      for (const key of missingKeys) {
        const defaultValue = DEFAULT_SETTINGS_MAP[key]?.value || {};
        cache.set(key, { value: defaultValue, expiresAt: now + 5000 });
        result[key] = defaultValue;
      }
      return result;
    }

    try {
      const docs = await M.Settings.find({ key: { $in: missingKeys } }).lean();
      const docMap = new Map(docs.map(d => [d.key, d.value]));

      for (const key of missingKeys) {
        const val = docMap.get(key);
        const defaultValue = DEFAULT_SETTINGS_MAP[key]?.value || {};
        const mergedValue = { ...defaultValue, ...(val || {}) };
        cache.set(key, { value: mergedValue, expiresAt: now + CACHE_TTL_MS });
        result[key] = mergedValue;
      }
    } catch (err) {
      for (const key of missingKeys) {
        const defaultValue = DEFAULT_SETTINGS_MAP[key]?.value || {};
        cache.set(key, { value: defaultValue, expiresAt: now + 5000 });
        result[key] = defaultValue;
      }
    }
  }

  return result;
}

/**
 * Invalidate cached setting value by key or completely.
 * @param {string} [key] - Key to invalidate. If omitted, clears all cache.
 */
function invalidateSettingsCache(key) {
  if (key) {
    cache.delete(key);
  } else {
    cache.clear();
  }
}

module.exports = {
  getSetting,
  getSettings,
  invalidateSettingsCache
};
