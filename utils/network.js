/**
 * utils/network.js
 * 
 * Campus IP and Wi-Fi check utility using Node.js net.BlockList (Resolves Checklist B34, L3).
 * Supports exact match, IPv4 & IPv6 CIDR subnets (e.g. 2401:4900::/32, 192.168.1.0/24),
 * IPv4-mapped IPv6 normalization, and fail-closed security for empty IP lists.
 */

'use strict';

const net = require('net');

/**
 * Normalizes an IP string by trimming and stripping IPv4-mapped IPv6 prefixes.
 * e.g. "::ffff:192.168.1.50" -> "192.168.1.50"
 * 
 * @param {string} ip
 * @returns {string}
 */
function normalizeIp(ip) {
  if (!ip || typeof ip !== 'string') return '';
  let clean = ip.trim();
  if (clean.startsWith('::ffff:')) {
    clean = clean.substring(7);
  }
  return clean;
}

/**
 * Builds a net.BlockList from an array of IP rules (strings).
 * Rules can be single IPv4/IPv6 addresses, CIDR ranges, or dot-prefixes.
 * 
 * @param {string[]} allowedIps
 * @returns {{ blockList: net.BlockList, dotPrefixes: string[], loopbackAllowed: boolean, exactRules: Set<string> }}
 */
function compileIpRules(allowedIps) {
  const blockList = new net.BlockList();
  const dotPrefixes = [];
  const exactRules = new Set();
  let loopbackAllowed = false;
  let ruleCount = 0;

  if (!Array.isArray(allowedIps)) {
    return { blockList, dotPrefixes, loopbackAllowed, exactRules, ruleCount: 0 };
  }

  for (const rawRule of allowedIps) {
    if (!rawRule || typeof rawRule !== 'string') continue;
    const rule = normalizeIp(rawRule);
    if (!rule) continue;

    exactRules.add(rule.toLowerCase());

    // Loopback check
    if (rule === '127.0.0.1' || rule === '::1' || rule.toLowerCase() === 'localhost') {
      loopbackAllowed = true;
    }

    // CIDR notation (e.g., 192.168.1.0/24 or 2401:4900::/32)
    if (rule.includes('/')) {
      const [addr, prefixStr] = rule.split('/');
      const prefix = parseInt(prefixStr, 10);
      const cleanAddr = normalizeIp(addr);
      const ipType = net.isIP(cleanAddr);

      if (ipType === 4 && !isNaN(prefix) && prefix >= 0 && prefix <= 32) {
        try {
          blockList.addSubnet(cleanAddr, prefix, 'ipv4');
          ruleCount++;
        } catch (_) {}
      } else if (ipType === 6 && !isNaN(prefix) && prefix >= 0 && prefix <= 128) {
        try {
          blockList.addSubnet(cleanAddr, prefix, 'ipv6');
          ruleCount++;
        } catch (_) {}
      }
      continue;
    }

    // Dot prefix match (e.g., "192.168.1.")
    if (rule.endsWith('.')) {
      dotPrefixes.push(rule);
      ruleCount++;
      continue;
    }

    // Single IP address
    const singleType = net.isIP(rule);
    if (singleType === 4) {
      try {
        blockList.addAddress(rule, 'ipv4');
        ruleCount++;
      } catch (_) {}
    } else if (singleType === 6) {
      try {
        blockList.addAddress(rule, 'ipv6');
        ruleCount++;
      } catch (_) {}
    }
  }

  return { blockList, dotPrefixes, loopbackAllowed, exactRules, ruleCount };
}

/**
 * Checks if a client IP is allowed within the campus IP list.
 * CRITICAL (L3 invariant): An empty campus IP list must NEVER allow everyone.
 * 
 * @param {string} rawClientIp - req.ip or client IP string
 * @param {string[]} allowedIps - array of allowed IPs or CIDR notations
 * @param {Object} [options]
 * @param {boolean} [options.allowLoopbackInDev=false] - whether to permit loopback when in development
 * @returns {boolean}
 */
function isCampusIpAllowed(rawClientIp, allowedIps, options = {}) {
  // L3 Invariant: Empty allowed list must not allow everyone
  if (!Array.isArray(allowedIps) || allowedIps.length === 0) {
    return false;
  }

  const clientIp = normalizeIp(rawClientIp);
  if (!clientIp) return false;

  const clientType = net.isIP(clientIp);
  if (clientType === 0) return false;

  const ipFamily = clientType === 4 ? 'ipv4' : 'ipv6';
  const { blockList, dotPrefixes, loopbackAllowed, exactRules, ruleCount } = compileIpRules(allowedIps);

  if (ruleCount === 0 && !loopbackAllowed && exactRules.size === 0) {
    return false;
  }

  // Check loopback
  const isClientLoopback = (clientIp === '127.0.0.1' || clientIp === '::1');
  if (isClientLoopback) {
    if (loopbackAllowed) return true;
    if (options.allowLoopbackInDev && process.env.NODE_ENV === 'development') return true;
  }

  // Exact rule match
  if (exactRules.has(clientIp.toLowerCase())) {
    return true;
  }

  // BlockList check (IPv4 and IPv6 CIDR subnets and single addresses)
  try {
    if (blockList.check(clientIp, ipFamily)) {
      return true;
    }
  } catch (_) {}

  // Dot-prefix match for legacy subnets
  for (const prefix of dotPrefixes) {
    if (clientIp.startsWith(prefix)) {
      return true;
    }
  }

  return false;
}

module.exports = {
  isCampusIpAllowed,
  normalizeIp,
  compileIpRules
};
