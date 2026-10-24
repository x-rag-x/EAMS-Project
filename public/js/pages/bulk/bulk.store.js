/**
 * bulk.store.js
 * Observable state store for EAMS Bulk Operations Chat Interface.
 */
(function (root) {
  'use strict';
  root.Bulk = root.Bulk || {};

  var listeners = [];
  var state = {
    user: null,
    caps: null,
    schema: {},
    chats: [],
    activeId: null,
    batch: null,
    messages: [],
    progress: null,
    drawerOpen: false,
    drawerFilter: 'all', // 'all' | 'pending' | 'verified'
    drawerSearch: '',
    drawerPage: 1,
    drawerPageSize: 25,
    search: '',
    filterType: 'all',
    filterStatus: 'all',
    archiveView: false,
    activeTab: 'chat', // 'chat' | 'restore'
    cache: {
      depts: [],
      classes: [],
      subjects: [],
      batches: [],
      years: []
    }
  };

  function getState() {
    return state;
  }

  function setState(patch) {
    if (!patch || typeof patch !== 'object') return;
    var changed = false;
    Object.keys(patch).forEach(function (k) {
      if (state[k] !== patch[k]) {
        state[k] = patch[k];
        changed = true;
      }
    });

    if (changed) {
      for (var i = 0; i < listeners.length; i++) {
        try {
          listeners[i](state);
        } catch (e) {
          console.error('Error in Bulk.store subscriber:', e);
        }
      }
    }
  }

  function subscribe(fn) {
    if (typeof fn !== 'function') return function () {};
    listeners.push(fn);
    return function unsubscribe() {
      var idx = listeners.indexOf(fn);
      if (idx !== -1) listeners.splice(idx, 1);
    };
  }

  root.Bulk.store = {
    getState: getState,
    setState: setState,
    subscribe: subscribe
  };
})(window);
