// BuildOrder.ai Service Worker v2
// App shell caching + offline fallback

const CACHE_NAME = 'buildorder-v2';

const PRECACHE = [
  '/offline.html',
  '/manifest.json'
];

// App shell pages — cached after first visit, served from cache when offline
const SHELL_PAGES = [
  '/dashboard.html',
  '/new-estimate.html',
  '/new-invoice.html',
  '/new-change-order.html',
  '/new-proposal.html',
  '/calendar.html',
  '/pricebook.html',
  '/clients.html',
  '/settings.html',
  '/jobs.html',
  '/index.html',
  '/'
];

// ── Install: precache critical files ──────────────────────────────────────────
self.addEventListener('install', function(e) {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(PRECACHE).catch(function() {});
    })
  );
});

// ── Activate: clear old caches ─────────────────────────────────────────────────
self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys
          .filter(function(k) { return k !== CACHE_NAME; })
          .map(function(k) { return caches.delete(k); })
      );
    }).then(function() { return self.clients.claim(); })
  );
});

// ── Fetch: network-first with offline fallback ─────────────────────────────────
self.addEventListener('fetch', function(e) {
  // Skip non-GET, API calls, Supabase, analytics, fonts
  if (e.request.method !== 'GET') return;
  var url = e.request.url;
  if (url.includes('/api/'))         return;
  if (url.includes('supabase.co'))   return;
  if (url.includes('googleapis.com')) return;
  if (url.includes('google-analytics')) return;
  if (url.includes('stripe.com'))    return;

  var isHTMLPage = e.request.headers.get('accept') &&
                   e.request.headers.get('accept').includes('text/html');

  if (isHTMLPage) {
    // HTML pages: network-first, cache on success, offline.html on total failure
    e.respondWith(
      fetch(e.request).then(function(response) {
        // Cache shell pages as we visit them
        var reqUrl = new URL(e.request.url).pathname;
        if (SHELL_PAGES.indexOf(reqUrl) !== -1) {
          var clone = response.clone();
          caches.open(CACHE_NAME).then(function(cache) { cache.put(e.request, clone); });
        }
        return response;
      }).catch(function() {
        return caches.match(e.request).then(function(cached) {
          return cached || caches.match('/offline.html');
        });
      })
    );
  } else {
    // Static assets: cache-first (JS, CSS, images, fonts)
    e.respondWith(
      caches.match(e.request).then(function(cached) {
        if (cached) return cached;
        return fetch(e.request).then(function(response) {
          if (response.ok) {
            var clone = response.clone();
            caches.open(CACHE_NAME).then(function(cache) { cache.put(e.request, clone); });
          }
          return response;
        }).catch(function() { return cached; });
      })
    );
  }
});
