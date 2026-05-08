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
  '/js/chat/reconnect-session.js',
  '/js/chat/push-subscription.js',
  '/js/chat/push-messages.js',
  '/js/restricted-webview.js',
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

self.addEventListener('push', function (event) {
  event.waitUntil(handlePush(event));
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();

  const chatId = event.notification && event.notification.data ?
    event.notification.data.chatId :
    '';
  const messageId = event.notification && event.notification.data ?
    event.notification.data.messageId :
    '';
  const url = chatId ?
    pushChatURL(chatId, messageId) :
    '/html/messageadd.html';

  event.waitUntil(openClientURL(url));
});

self.addEventListener('pushsubscriptionchange', function (event) {
  event.waitUntil(refreshPushSubscription(event));
});

function handlePush(event) {
  const payload = parsePushPayload(event);
  if (!payload || !payload.chatId || !payload.messageId) {
    return Promise.resolve();
  }

  return savePushMessage(payload).then(function () {
    return self.registration.showNotification('New message in Technochat', {
      body: payload.sender ? 'Message from ' + payload.sender : 'Open chat to read it',
      icon: '/images/icon-192x192.png',
      badge: '/images/icon-192x192.png',
      tag: 'technochat:' + payload.chatId + ':' + payload.messageId,
      renotify: true,
      data: {
        chatId: payload.chatId,
        messageId: payload.messageId
      }
    });
  });
}

function parsePushPayload(event) {
  try {
    return event.data ? event.data.json() : null;
  } catch (error) {
    console.warn('could not parse push payload', error);
    return null;
  }
}

function refreshPushSubscription(event) {
  const newSubscription = event && event.newSubscription ? event.newSubscription : null;
  if (newSubscription) {
    return notifyClientsOfPushSubscription(normalizePushSubscription(newSubscription));
  }

  return loadVAPIDPublicKey().then(function (publicKey) {
    if (!publicKey) {
      return null;
    }

    return self.registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey)
    });
  }).then(function (subscription) {
    if (!subscription) {
      return null;
    }

    return notifyClientsOfPushSubscription(normalizePushSubscription(subscription));
  }).catch(function (error) {
    console.warn('could not refresh push subscription', error);
  });
}

function loadVAPIDPublicKey() {
  return fetch('/api/v1/push/vapid-public-key', {
    method: 'GET',
    headers: { 'Accept': 'application/json' }
  }).then(function (response) {
    if (!response.ok) {
      return '';
    }

    return response.json();
  }).then(function (payload) {
    const body = payload && payload.body ? payload.body : {};
    if (!body.enabled) {
      return '';
    }

    return String(body.public_key || '');
  });
}

function notifyClientsOfPushSubscription(subscription) {
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clients) {
    return Promise.all(clients.map(function (client) {
      client.postMessage({
        type: 'technochat:push-subscription-changed',
        subscription: subscription
      });
      return Promise.resolve();
    }));
  });
}

function normalizePushSubscription(subscription) {
  const json = subscription && typeof subscription.toJSON === 'function' ?
    subscription.toJSON() :
    subscription;

  return {
    endpoint: String(json && json.endpoint || ''),
    keys: {
      auth: String(json && json.keys && json.keys.auth || ''),
      p256dh: String(json && json.keys && json.keys.p256dh || '')
    }
  };
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }

  return outputArray;
}

function pushChatURL(chatId, messageId) {
  const url = new URL('/html/joinchat.html', self.location.origin);
  url.searchParams.set('id', chatId);
  url.searchParams.set('open_source', 'push');
  if (messageId) {
    url.searchParams.set('push_message_id', messageId);
  }

  return url.pathname + url.search;
}

function openClientURL(url) {
  const targetURL = new URL(url, self.location.origin);

  return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clients) {
    for (let i = 0; i < clients.length; i++) {
      const clientURL = new URL(clients[i].url);
      if (clientURL.origin === self.location.origin && clientURL.pathname === '/html/joinchat.html') {
        clientURL.search = targetURL.search;
        clientURL.hash = targetURL.hash;
        return clients[i].navigate(clientURL.toString()).then(function (client) {
          return client.focus();
        });
      }
    }

    return self.clients.openWindow(url);
  });
}

function savePushMessage(payload) {
  return openPushDB().then(function (db) {
    return new Promise(function (resolve, reject) {
      const tx = db.transaction('messages', 'readwrite');
      const store = tx.objectStore('messages');

      store.put({
        key: payload.chatId + ':' + payload.messageId,
        chatId: payload.chatId,
        messageId: payload.messageId,
        messageSeq: payload.messageSeq,
        sender: payload.sender,
        data: payload.data,
        timestamp: payload.timestamp
      });

      tx.oncomplete = function () {
        db.close();
        resolve();
      };
      tx.onerror = function (event) {
        db.close();
        reject(event.target.error);
      };
      tx.onabort = function (event) {
        db.close();
        reject(event.target.error);
      };
    });
  });
}

function openPushDB() {
  return new Promise(function (resolve, reject) {
    const request = indexedDB.open('technochat-push-messages', 1);

    request.onupgradeneeded = function (event) {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('messages')) {
        const store = db.createObjectStore('messages', { keyPath: 'key' });
        store.createIndex('chatId', 'chatId', { unique: false });
      }
    };
    request.onsuccess = function (event) {
      resolve(event.target.result);
    };
    request.onerror = function (event) {
      reject(event.target.error);
    };
  });
}
