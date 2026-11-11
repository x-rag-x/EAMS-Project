/**
 * Core HTML & Attribute Escape Utility
 * Escapes &, <, >, ", ', `, and / to prevent both HTML body and attribute injection (XSS).
 */
(function (global) {
  'use strict';

  var HTML_CHAR_MAP = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
    '`': '&#96;',
    '/': '&#x2F;'
  };

  var ESCAPE_REGEX = /[&<>"'`\/]/g;

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(ESCAPE_REGEX, function (c) {
      return HTML_CHAR_MAP[c] || c;
    });
  }

  var esc = escapeHtml;

  function safeHref(url) {
    if (!url || typeof url !== 'string') return '#';
    var trimmed = url.trim();
    if (/^(?:javascript|data|vbscript):/i.test(trimmed)) return '#';
    if (trimmed.startsWith('/') || trimmed.startsWith('./') || trimmed.startsWith('#')) return trimmed;
    try {
      var origin = (typeof window !== 'undefined' && window.location && window.location.origin) ? window.location.origin : 'http://localhost';
      var parsed = new URL(trimmed, origin);
      if (parsed.protocol === 'https:' || (parsed.protocol === 'http:' && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'))) {
        return trimmed;
      }
    } catch (e) {}
    return '#';
  }

  global.escapeHtml = escapeHtml;
  global.safeHref = safeHref;
  global.esc = esc;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { escapeHtml: escapeHtml, esc: esc, safeHref: safeHref };
  }
})(typeof window !== 'undefined' ? window : globalThis);
