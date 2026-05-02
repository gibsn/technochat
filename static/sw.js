const CACHE_NAME = 'technochat-__STATIC_VERSION__';
const IS_LOCAL_DEV = self.location.hostname === '127.0.0.1' || self.location.hostname === 'localhost';

const CACHE_URLS = [
  '/html/messageadd.html',
  '/html/messageview.html',
  '/html/initchat.html',
  '/html/joinchat.html',
  '/manifest.webmanifest',
  '/css/main.css',
  '/css/adaptive.css',
  '/css/chat.css',
  '/css/lib/emojione.min.css',
  '/css/lib/material_icons.css',
  '/css/fonts/press-start-2p-v16.ttf',
  '/css/fonts/ubuntu-mono-v19-bold.ttf',
  '/css/fonts/ubuntu-mono-v19-regular.ttf',
  '/css/fonts/material-icons-v38.ttf',
  '/js/network-loader.js',
  '/js/pwa.js',
  '/js/message/add.js',
  '/js/message/view.js',
  '/js/message/crypto.js',
  '/js/chat/init.js',
  '/js/chat/chat.js',
  '/js/util.js',
  '/js/lib/jquery-3.6.0.min.js',
  '/js/lib/vue.min.js',
  '/js/lib/emojione.min.js',
  '/js/lib/heic2any.min.js',
  '/js/lib/md5.js',
  '/js/lib/materialize.min.js',
  '/js/lib/PageTitleNotification.js',
  '/media/icons/close.svg',
  '/images/apple-touch-icon.png',
  '/images/apple-touch-icon-167x167.png',
  '/images/apple-touch-icon-152x152.png',
  '/images/apple-touch-icon-120x120.png',
  '/images/icon.svg',
  '/images/icon-512x512.png',
  '/images/icon-192x192.png',
  '/robots.txt',
  '/favicon.ico'
];

function cacheURLs(cache, urls) {
  return urls.reduce(function (promise, url) {
    return promise.then(function () {
      return cache.add(url);
    });
  }, Promise.resolve());
}

if (IS_LOCAL_DEV) {
  self.addEventListener('install', function (event) {
    event.waitUntil(self.skipWaiting());
  });

  self.addEventListener('activate', function (event) {
    event.waitUntil(
      self.registration.unregister().then(function () {
        return self.clients.matchAll({ type: 'window' });
      }).then(function (clients) {
        return Promise.all(clients.map(function (client) {
          return client.navigate(client.url);
        }));
      })
    );
  });
} else {
  self.addEventListener('install', function (event) {
    event.waitUntil(
      caches.open(CACHE_NAME).then(function (cache) {
        return cacheURLs(cache, CACHE_URLS);
      }).then(function () {
        return self.skipWaiting();
      })
    );
  });

  self.addEventListener('activate', function (event) {
    let deletedOldCache = false;

    event.waitUntil(
      caches.keys().then(function (cacheNames) {
        return Promise.all(cacheNames.map(function (cacheName) {
          if (cacheName !== CACHE_NAME) {
            deletedOldCache = true;
            return caches.delete(cacheName);
          }

          return Promise.resolve();
        }));
      }).then(function () {
        return self.clients.claim();
      }).then(function () {
        if (!deletedOldCache) {
          return Promise.resolve();
        }

        return self.clients.matchAll({ type: 'window' }).then(function (clients) {
          return Promise.all(clients.map(function (client) {
            return client.navigate(client.url);
          }));
        });
      })
    );
  });

  self.addEventListener('fetch', function (event) {
    const url = new URL(event.request.url);

    if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) {
      return;
    }

    function fetchAndCache(request) {
      return fetch(request).then(function (response) {
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }

        const responseToCache = response.clone();
        caches.open(CACHE_NAME).then(function (cache) {
          cache.put(request, responseToCache);
        });

        return response;
      });
    }

    if (event.request.mode === 'navigate') {
      event.respondWith(
        fetchAndCache(event.request).catch(function () {
          return caches.match(url.pathname).then(function (cachedResponse) {
            if (cachedResponse) {
              return cachedResponse;
            }

            return caches.match('/html/messageadd.html');
          }).then(function (cachedResponse) {
            return cachedResponse || new Response('Service unavailable', {
              status: 503,
              headers: { 'Content-Type': 'text/plain' }
            });
          });
        })
      );
      return;
    }

    event.respondWith(
      caches.match(event.request).then(function (cachedResponse) {
        if (cachedResponse) {
          return cachedResponse;
        }

        return fetchAndCache(event.request);
      }).catch(function () {
        return new Response('', { status: 503 });
      })
    );
  });
}
