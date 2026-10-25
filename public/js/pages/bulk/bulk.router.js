/**
 * bulk.router.js
 * Clean URL and History Manager for Bulk Operations.
 *
 * Requirements (Phase 1):
 * - Direct routing via ?bulk={track-id} (e.g. bulk.html?bulk=TR-BKTCH-7K3QF)
 * - Transparent backward-compatibility for legacy ?chat={mongo-id} links
 * - Push/replaceState URL updates without page reload
 * - Copy Link generator
 * - Friendly Not-Found empty state handling
 */
(function (root) {
  'use strict';
  root.Bulk = root.Bulk || {};

  var router = {};

  /**
   * Parse current URL parameters to determine initial target
   */
  router.getRoute = function () {
    var params = new URLSearchParams(window.location.search);
    var bulkTrackId = params.get('bulk');
    var legacyChatId = params.get('chat');
    var tab = params.get('tab') || params.get('page');

    if (tab === 'restore') {
      return { tab: 'restore', id: null, isLegacy: false };
    }

    if (bulkTrackId) {
      return { tab: 'chat', id: bulkTrackId.trim(), isLegacy: false };
    }

    if (legacyChatId) {
      return { tab: 'chat', id: legacyChatId.trim(), isLegacy: true };
    }

    return { tab: 'chat', id: null, isLegacy: false };
  };

  /**
   * Set or clear the active bulk trackId in URL
   * @param {string|null} trackId - The batchTrackId (e.g. TR-BKTCH-7K3QF)
   * @param {Object} [opts] - { replace: Boolean }
   */
  router.setBulk = function (trackId, opts) {
    if (!window.history || !window.history.pushState) return;
    opts = opts || {};

    var url = new URL(window.location.href);
    url.searchParams.delete('chat');

    if (trackId) {
      url.searchParams.set('bulk', trackId);
    } else {
      url.searchParams.delete('bulk');
    }

    var nextUrl = url.pathname + (url.search ? url.search : '') + url.hash;
    if (opts.replace) {
      window.history.replaceState({ trackId: trackId }, '', nextUrl);
    } else {
      window.history.pushState({ trackId: trackId }, '', nextUrl);
    }
  };

  /**
   * Switch tab in URL
   */
  router.setTab = function (tab, opts) {
    if (!window.history || !window.history.pushState) return;
    opts = opts || {};
    var url = new URL(window.location.href);
    if (tab === 'restore') {
      url.searchParams.set('tab', 'restore');
      url.searchParams.delete('bulk');
      url.searchParams.delete('chat');
    } else {
      url.searchParams.delete('tab');
    }
    var nextUrl = url.pathname + (url.search ? url.search : '') + url.hash;
    if (opts.replace) {
      window.history.replaceState({ tab: tab }, '', nextUrl);
    } else {
      window.history.pushState({ tab: tab }, '', nextUrl);
    }
  };

  /**
   * Copy shareable chat URL to clipboard and show toast
   */
  router.copyLink = function (trackId) {
    if (!trackId) return;
    var fullUrl = window.location.origin + window.location.pathname + '?bulk=' + encodeURIComponent(trackId);

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(fullUrl).then(function () {
        if (typeof root.showToast === 'function') {
          root.showToast('Chat link copied to clipboard', 'black');
        }
      }).catch(function () {
        fallbackCopy(fullUrl);
      });
    } else {
      fallbackCopy(fullUrl);
    }
  };

  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try {
      document.execCommand('copy');
      if (typeof root.showToast === 'function') {
        root.showToast('Chat link copied to clipboard', 'black');
      }
    } catch (_) {}
    document.body.removeChild(ta);
  }

  root.Bulk.router = router;
})(window);
