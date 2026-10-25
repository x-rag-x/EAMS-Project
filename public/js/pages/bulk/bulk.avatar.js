/**
 * public/js/pages/bulk/bulk.avatar.js
 * Deterministic avatar generation and 12-hue accessible color assignment.
 * Zero storage: colors and initials are computed purely client-side from userId.
 */
(function (root) {
  'use strict';
  root.Bulk = root.Bulk || {};

  var PALETTE = [
    '#15803d', /* Green 700   (5.02:1 contrast) */
    '#1d4ed8', /* Blue 700    (6.70:1 contrast) */
    '#7e22ce', /* Purple 700  (6.98:1 contrast) */
    '#b91c1c', /* Red 700     (6.47:1 contrast) */
    '#0f766e', /* Teal 700    (5.47:1 contrast) */
    '#c2410c', /* Orange 700  (5.18:1 contrast) */
    '#4338ca', /* Indigo 700  (7.90:1 contrast) */
    '#a21caf', /* Fuchsia 700 (6.32:1 contrast) */
    '#0369a1', /* Sky 700     (5.93:1 contrast) */
    '#b45309', /* Amber 700   (5.02:1 contrast) */
    '#374151', /* Gray 700   (10.31:1 contrast) */
    '#1e3a8a'  /* Dark Blue  (10.36:1 contrast) */
  ];

  /**
   * Deterministic 32-bit integer string hash
   */
  function hash(str) {
    var h = 0;
    var s = String(str || '');
    for (var i = 0; i < s.length; i++) {
      h = ((h << 5) - h) + s.charCodeAt(i);
      h |= 0;
    }
    return Math.abs(h);
  }

  /**
   * Extract 1-2 letter initials from a display name
   * @param {string} name
   * @returns {string}
   */
  function initials(name) {
    if (!name) return '?';
    var clean = String(name).trim().replace(/^(Dr\.|Prof\.|Mr\.|Mrs\.|Ms\.)\s+/i, '');
    var parts = clean.split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
    var first = parts[0].charAt(0).toUpperCase();
    var last = parts[parts.length - 1].charAt(0).toUpperCase();
    return first + last;
  }

  /**
   * Deterministic accessible background color
   * @param {string} userId
   * @returns {string}
   */
  function color(userId) {
    if (!userId) return PALETTE[0];
    return PALETTE[hash(userId) % PALETTE.length];
  }

  /**
   * Render avatar element HTML markup
   * @param {Object} actor
   * @param {Object} [opts]
   * @returns {string}
   */
  function render(actor, opts) {
    opts = opts || {};
    var isSystem = !actor || actor.tier === 'system' || actor.role === 'system' || actor.name === 'EAMS Assistant' || actor.name === 'System';

    if (isSystem) {
      var iconHtml = (typeof root.getIconSvg === 'function')
        ? root.getIconSvg('shield-check', { size: 16 })
        : '<re-icon icon="shield-check" size="16"></re-icon>';
      return '<div class="chat-sb-avatar msg-avatar system" aria-hidden="true">' + iconHtml + '</div>';
    }

    var uid = actor.userId || actor._id || actor.name || '';
    var bgCol = color(uid);
    var inits = initials(actor.name || 'User');

    return '<div class="chat-sb-avatar msg-avatar" style="background-color:' + bgCol + ';" aria-hidden="true">' + inits + '</div>';
  }

  root.Bulk.avatar = {
    PALETTE: PALETTE,
    hash: hash,
    initials: initials,
    color: color,
    render: render
  };

})(typeof window !== 'undefined' ? window : global);
