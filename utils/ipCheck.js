/**
 * Campus IP and Wi-Fi check utility.
 * Resolves Finding A8, B34, and L3.
 * Delegates to utils/network.js using Node.js net.BlockList for robust IPv4 & IPv6 CIDR matching.
 */

'use strict';

const { isCampusIpAllowed, normalizeIp } = require('./network');

function isIpInCidr(clientIp, cidr) {
  if (!cidr) return false;
  return isCampusIpAllowed(clientIp, [cidr]);
}

module.exports = {
  isCampusIpAllowed,
  normalizeIp,
  isIpInCidr
};
