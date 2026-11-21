/**
 * utils/sessionLocationCache.js
 * 
 * In-memory TTL cache for session GPS location & verification context.
 * Resolves Checklist B9: Automatically prunes expired entries so memory does not grow unboundedly.
 */

'use strict';

class SessionLocationCache {
  /**
   * @param {Object} [options]
   * @param {number} [options.defaultTtlMs=900000] - 15 minutes default TTL
   * @param {number} [options.maxSize=5000] - maximum entries allowed before proactive LRU eviction
   * @param {number} [options.pruneIntervalMs=60000] - background cleanup every 60s
   */
  constructor(options = {}) {
    this.defaultTtlMs = options.defaultTtlMs || 15 * 60 * 1000;
    this.maxSize = options.maxSize || 5000;
    this.cache = new Map();
    this.pruneTimer = null;

    if (options.autoPrune !== false) {
      this.startPruner(options.pruneIntervalMs || 60000);
    }
  }

  /**
   * Set location record for session
   * @param {string} key
   * @param {Object} value
   * @param {number} [ttlMs]
   */
  set(key, value, ttlMs) {
    if (!key) return;
    const effectiveTtl = typeof ttlMs === 'number' && ttlMs > 0 ? ttlMs : this.defaultTtlMs;
    const now = Date.now();

    // If cache exceeds max size, aggressively prune expired or oldest entries
    if (this.cache.size >= this.maxSize) {
      this.prune();
      if (this.cache.size >= this.maxSize) {
        // Evict oldest entry (first key in Map insertion order)
        const oldestKey = this.cache.keys().next().value;
        if (oldestKey) this.cache.delete(oldestKey);
      }
    }

    this.cache.set(String(key), {
      data: value,
      expiresAt: now + effectiveTtl,
      createdAt: now
    });
  }

  /**
   * Get location record by session key
   * @param {string} key
   * @returns {Object|null}
   */
  get(key) {
    if (!key) return null;
    const entry = this.cache.get(String(key));
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(String(key));
      return null;
    }

    return entry.data;
  }

  /**
   * Check if session key exists and is unexpired
   * @param {string} key
   * @returns {boolean}
   */
  has(key) {
    return this.get(key) !== null;
  }

  /**
   * Delete entry explicitly
   * @param {string} key
   * @returns {boolean}
   */
  delete(key) {
    if (!key) return false;
    return this.cache.delete(String(key));
  }

  /**
   * Clear all entries
   */
  clear() {
    this.cache.clear();
  }

  /**
   * Prunes all expired entries from cache.
   * @returns {number} count of pruned entries
   */
  prune() {
    const now = Date.now();
    let prunedCount = 0;
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
        prunedCount++;
      }
    }
    return prunedCount;
  }

  /**
   * Current unexpired size of cache
   * @returns {number}
   */
  size() {
    this.prune();
    return this.cache.size;
  }

  /**
   * Start background periodic pruning
   * @param {number} intervalMs
   */
  startPruner(intervalMs = 60000) {
    if (this.pruneTimer) return;
    this.pruneTimer = setInterval(() => {
      this.prune();
    }, intervalMs);
    if (this.pruneTimer.unref) {
      this.pruneTimer.unref();
    }
  }

  /**
   * Stop background pruning
   */
  stopPruner() {
    if (this.pruneTimer) {
      clearInterval(this.pruneTimer);
      this.pruneTimer = null;
    }
  }
}

// Global singleton instance
const defaultCache = new SessionLocationCache();

module.exports = defaultCache;
module.exports.SessionLocationCache = SessionLocationCache;
