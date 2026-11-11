/**
 * public/tt-sw.js
 * EAMS Timetable v3 — Service Worker App Shell & Offline Asset Cache (Phase 7, Section 2.1 & 2.2)
 *
 * Implements:
 * 1. Precaching of essential application shell assets (HTML, CSS, core JS modules)
 * 2. Stale-While-Revalidate for fingerprinted static assets
 * 3. Network-First with 4s timeout fallback for shell navigation
 * 4. Automatic cache invalidation on new version activation
 * 5. Strict security rule: Service worker NEVER handles writes (POST/PUT/PATCH/DELETE)
 */

'use strict';

const CACHE_VERSION = 'tt-shell-v1.0.1';
const PRECACHE_ASSETS = [
  '/timetable.html',
  '/css/base.css',
  '/css/timetable.css',
  '/css/timetable.tokens.css',
  '/css/timetable.mobile.css',
  '/js/core/session.js',
  '/js/core/api.js',
  '/js/core/toast.js',
  '/js/core/modal.js',
  '/js/core/popup.js',
  '/js/core/guard.js',
  '/js/core/tabWorkspace.js',
  '/js/core/icons.js',
  '/js/core/icons.timetable.js',
  '/js/shared/ttConflicts.shared.js',
  '/js/modules/net.module.js',
  '/js/modules/offline.module.js',
  '/js/modules/hub.module.js',
  '/js/modules/compare.module.js',
  '/js/modules/approvals.module.js',
  '/js/modules/share.module.js',
  '/js/modules/deploy.module.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => {
      // Pre-cache individual assets gracefully (some CSS/JS might be optional or relative)
      return Promise.allSettled(
        PRECACHE_ASSETS.map(url =>
          fetch(url).then(res => {
            if (res.ok) return cache.put(url, res);
            return null;
          }).catch(() => null)
        )
      );
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter(k => k.startsWith('tt-shell-') && k !== CACHE_VERSION)
          .map(k => caches.delete(k))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Security Invariant: NEVER intercept or cache write requests
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return;
  }

  // Never cache API mutations or socket paths
  if (url.pathname.startsWith('/api/') && !url.pathname.includes('/snapshot') && !url.pathname.includes('/ping')) {
    return;
  }

  // 1. Navigation Request (App Shell Network-First with 4s timeout)
  if (req.mode === 'navigate' || url.pathname.endsWith('timetable.html')) {
    event.respondWith(
      new Promise((resolve) => {
        let timedOut = false;
        const timer = setTimeout(() => {
          timedOut = true;
          caches.match('/timetable.html').then(cached => {
            if (cached) resolve(cached);
          });
        }, 4000);

        fetch(req).then(networkRes => {
          clearTimeout(timer);
          if (!timedOut) {
            if (networkRes && networkRes.ok) {
              const clone = networkRes.clone();
              caches.open(CACHE_VERSION).then(cache => cache.put(req, clone));
            }
            resolve(networkRes);
          }
        }).catch(() => {
          clearTimeout(timer);
          caches.match('/timetable.html').then(cached => {
            resolve(cached || new Response('Offline: App shell unavailable', { status: 503 }));
          });
        });
      })
    );
    return;
  }

  // 2. Static Assets (Stale-While-Revalidate)
  if (url.pathname.startsWith('/css/') || url.pathname.startsWith('/js/')) {
    event.respondWith(
      caches.match(req).then((cached) => {
        const fetchPromise = fetch(req).then((networkRes) => {
          if (networkRes && networkRes.ok) {
            const clone = networkRes.clone();
            caches.open(CACHE_VERSION).then(c => c.put(req, clone));
          }
          return networkRes;
        }).catch(() => cached);

        return cached || fetchPromise;
      })
    );
  }
});
