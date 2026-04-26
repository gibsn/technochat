const CACHE_NAME = 'technochat-__STATIC_VERSION__';

const CACHE_URLS = [
  '/html/messageadd.html',
  '/css/main.css',
  '/css/adaptive.css',
  '/js/pwa.js',
  '/js/message/add.js',
  '/js/lib/jquery-3.6.0.min.js',
  '/images/apple-touch-icon.png',
  '/images/apple-touch-icon-167x167.png',
  '/images/apple-touch-icon-152x152.png',
  '/images/apple-touch-icon-120x120.png',
  '/images/icon.svg',
  '/images/icon-512x512.png',
  '/images/icon-192x192.png',
  '/favicon.ico'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(CACHE_URLS);
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (cacheNames) {
      return Promise.all(cacheNames.map(function (cacheName) {
        if (cacheName !== CACHE_NAME) {
          return caches.delete(cacheName);
        }

        return Promise.resolve();
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function (event) {
  const url = new URL(event.request.url);

  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then(function (cachedResponse) {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(event.request).then(function (response) {
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }

        const responseToCache = response.clone();
        caches.open(CACHE_NAME).then(function (cache) {
          cache.put(event.request, responseToCache);
        });

        return response;
      });
    })
  );
});
