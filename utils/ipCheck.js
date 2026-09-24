/**
 * Campus IP and Wi-Fi check utility.
 * Resolves Finding A8 by replacing insecure .includes() substring checks
 * with rigorous exact match, CIDR subnet matching, and loopback handling.
 */

function normalizeIp(ip) {
  if (!ip || typeof ip !== 'string') return '';
  let clean = ip.trim();
  // Strip IPv4-mapped IPv6 prefix (e.g. ::ffff:192.168.1.1 -> 192.168.1.1)
  if (clean.startsWith('::ffff:')) {
    clean = clean.substring(7);
  }
  return clean;
}

function ipv4ToInt(ip) {
  const parts = ip.split('.').map(p => parseInt(p, 10));
  if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) {
    return null;
  }
  return (((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0);
}

function isIpInCidr(clientIp, cidr) {
  const [range, bitsStr] = cidr.split('/');
  const bits = parseInt(bitsStr, 10);
  if (isNaN(bits) || bits < 0 || bits > 32) return false;

  const clientInt = ipv4ToInt(clientIp);
  const rangeInt = ipv4ToInt(range);
  if (clientInt === null || rangeInt === null) return false;

  const mask = bits === 0 ? 0 : (~((1 << (32 - bits)) - 1)) >>> 0;
  return (clientInt & mask) === (rangeInt & mask);
}

/**
 * Checks if clientIp is in the allowed campus IP list.
 * 
 * @param {string} rawClientIp - req.ip
 * @param {string[]} allowedIps - array of allowed IPs or CIDR notations from Settings
 * @returns {boolean}
 */
function isCampusIpAllowed(rawClientIp, allowedIps) {
  if (!Array.isArray(allowedIps) || allowedIps.length === 0) {
    return true; // Empty allowed list means no restriction configured
  }

  const clientIp = normalizeIp(rawClientIp);
  if (!clientIp) return false;

  for (const rule of allowedIps) {
    if (!rule || typeof rule !== 'string') continue;
    const cleanRule = normalizeIp(rule);

    // Loopback match (IPv4 or IPv6)
    if (
      (clientIp === '127.0.0.1' || clientIp === '::1') &&
      (cleanRule === '127.0.0.1' || cleanRule === '::1' || cleanRule === 'localhost')
    ) {
      return true;
    }

    // Exact string match
    if (clientIp === cleanRule) {
      return true;
    }

    // CIDR range match (e.g. 192.168.1.0/24)
    if (cleanRule.includes('/')) {
      if (isIpInCidr(clientIp, cleanRule)) {
        return true;
      }
      continue;
    }

    // Exact prefix match with dot boundary (e.g. "192.168.1." matching "192.168.1.50")
    if (cleanRule.endsWith('.') && clientIp.startsWith(cleanRule)) {
      return true;
    }
  }

  return false;
}

module.exports = {
  isCampusIpAllowed,
  normalizeIp,
  isIpInCidr
};
