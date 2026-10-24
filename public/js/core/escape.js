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

  global.escapeHtml = escapeHtml;
  global.esc = esc;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { escapeHtml: escapeHtml, esc: esc };
  }
})(typeof window !== 'undefined' ? window : globalThis);
