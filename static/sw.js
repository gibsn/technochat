const CACHE_NAME = 'technochat-__STATIC_VERSION__';

const CACHE_URLS = [
  '/html/messageadd.html',
  '/html/messageview.html',
  '/html/initchat.html',
  '/html/joinchat.html',
  '/css/main.css',
  '/css/adaptive.css',
  '/css/chat.css',
  '/css/lib/material_icons.css',
  '/css/lib/emojione.min.css',
  '/js/pwa.js',
  '/js/util.js',
  '/js/message/add.js',
  '/js/message/view.js',
  '/js/message/crypto.js',
  '/js/chat/init.js',
  '/js/chat/chat.js',
  '/js/lib/jquery-3.6.0.min.js',
  '/js/lib/vue.min.js',
  '/js/lib/emojione.min.js',
  '/js/lib/md5.js',
  '/js/lib/materialize.min.js',
  '/js/lib/PageTitleNotification.js',
  '/images/icon.svg',
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
