// BuildOrder.ai Service Worker
// Enables PWA installability. Minimal caching — app is auth-gated so we
// don't cache protected pages. Just cache static assets for performance.

const CACHE_NAME = 'buildorder-v1';
const STATIC_ASSETS = [
  '/manifest.json',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap'
];

self.addEventListener('install', function(e) {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(STATIC_ASSETS).catch(function() {});
    })
  );
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE_NAME; }).map(function(k) { return caches.delete(k); })
      );
    }).then(function() { return self.clients.claim(); })
  );
});

// Network-first strategy — always get fresh data, fall back to cache for static assets
self.addEventListener('fetch', function(e) {
  // Skip non-GET, API calls, and Supabase calls — always network for these
  if (e.request.method !== 'GET') return;
  if (e.request.url.includes('/api/') || e.request.url.includes('supabase.co')) return;

  e.respondWith(
    fetch(e.request).catch(function() {
      return caches.match(e.request);
    })
  );
});
