(function () {
  if (!('serviceWorker' in navigator)) {
    return;
  }

  if (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost') {
    navigator.serviceWorker.getRegistrations().then(function (registrations) {
      registrations.forEach(function (registration) {
        registration.unregister();
      });
    }).catch(function (err) {
      console.warn('service worker cleanup failed', err);
    });
    return;
  }

  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/sw.js').catch(function (err) {
      console.warn('service worker registration failed', err);
    });
  });
}());
