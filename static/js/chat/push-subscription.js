const vapidPublicKeyURL = '/api/v1/push/vapid-public-key';
let vapidPublicKeyPromise = null;
let vapidPublicKeyLoaded = false;
let vapidPublicKey = '';

export async function currentPushSubscription(requestPermission) {
    if (!pushSupported()) {
        return null;
    }
    if (isLocalDevHost()) {
        return null;
    }

    if (Notification.permission === 'denied') {
        return null;
    }

    let publicKey = '';
    if (vapidPublicKeyLoaded) {
        publicKey = vapidPublicKey;
    } else {
        publicKey = await loadCachedVAPIDPublicKey();
    }
    if (!publicKey) {
        return null;
    }

    if (Notification.permission !== 'granted') {
        if (!requestPermission) {
            return null;
        }

        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
            return null;
        }
    }

    const applicationServerKey = urlBase64ToUint8Array(publicKey);
    const registration = await navigator.serviceWorker.register('/sw.js');
    let subscription = await registration.pushManager.getSubscription();
    if (subscription && !subscriptionMatchesApplicationServerKey(subscription, applicationServerKey)) {
        await subscription.unsubscribe();
        subscription = null;
    }
    if (!subscription) {
        subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: applicationServerKey,
        });
    }

    return normalizeSubscription(subscription);
}

export function preloadVAPIDPublicKey() {
    if (!pushSupported() || isLocalDevHost()) {
        return Promise.resolve('');
    }

    return loadCachedVAPIDPublicKey();
}

export function pushSupported() {
    return 'Notification' in window &&
        'serviceWorker' in navigator &&
        'PushManager' in window;
}

export function pushPermission() {
    if (!('Notification' in window)) {
        return 'unsupported';
    }

    return Notification.permission;
}

async function loadCachedVAPIDPublicKey() {
    if (vapidPublicKeyLoaded) {
        return vapidPublicKey;
    }
    if (!vapidPublicKeyPromise) {
        vapidPublicKeyPromise = loadVAPIDPublicKey();
    }

    vapidPublicKey = await vapidPublicKeyPromise;
    vapidPublicKeyLoaded = true;

    return vapidPublicKey;
}

async function loadVAPIDPublicKey() {
    const response = await window.fetch(vapidPublicKeyURL, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
    });
    if (!response.ok) {
        return '';
    }

    const payload = await response.json();
    const body = payload && payload.body ? payload.body : {};
    if (!body.enabled) {
        return '';
    }

    return String(body.public_key || '');
}

function normalizeSubscription(subscription) {
    const json = subscription && typeof subscription.toJSON === 'function' ?
        subscription.toJSON() :
        subscription;

    return {
        endpoint: String(json && json.endpoint || ''),
        keys: {
            auth: String(json && json.keys && json.keys.auth || ''),
            p256dh: String(json && json.keys && json.keys.p256dh || ''),
        },
    };
}

export function subscriptionMatchesApplicationServerKey(subscription, applicationServerKey) {
    const subscriptionKey = subscription && subscription.options ?
        subscription.options.applicationServerKey :
        null;
    if (!subscriptionKey) {
        return true;
    }

    return arrayBufferEquals(subscriptionKey, applicationServerKey);
}

function arrayBufferEquals(left, right) {
    const leftBytes = new Uint8Array(left);
    const rightBytes = new Uint8Array(right);
    if (leftBytes.length !== rightBytes.length) {
        return false;
    }

    for (let i = 0; i < leftBytes.length; i++) {
        if (leftBytes[i] !== rightBytes[i]) {
            return false;
        }
    }

    return true;
}

function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
        .replace(/-/g, '+')
        .replace(/_/g, '/');

    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; i++) {
        outputArray[i] = rawData.charCodeAt(i);
    }

    return outputArray;
}

function isLocalDevHost() {
    return window.location.hostname === '127.0.0.1' ||
        window.location.hostname === 'localhost';
}
