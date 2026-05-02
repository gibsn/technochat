(function () {
    const loaderId = 'network_loader';
    const visibleClass = 'network-loader--visible';
    const settlingDelayMs = 120;

    let activeRequests = 0;
    let hideTimer = null;

    function ensureLoader() {
        let loader = document.getElementById(loaderId);
        if (loader) {
            return loader;
        }

        if (!document.body) {
            return null;
        }

        loader = document.createElement('div');
        loader.id = loaderId;
        loader.className = 'network-loader';
        loader.setAttribute('role', 'status');
        loader.setAttribute('aria-live', 'polite');
        loader.setAttribute('aria-label', 'Loading');

        const bar = document.createElement('span');
        bar.className = 'network-loader__bar';
        bar.setAttribute('aria-hidden', 'true');
        loader.appendChild(bar);

        document.body.appendChild(loader);
        return loader;
    }

    function showLoader() {
        if (hideTimer) {
            window.clearTimeout(hideTimer);
            hideTimer = null;
        }

        const loader = ensureLoader();
        if (loader) {
            loader.classList.add(visibleClass);
        }
    }

    function hideLoader() {
        if (activeRequests > 0) {
            return;
        }

        hideTimer = window.setTimeout(function () {
            const loader = ensureLoader();
            if (loader) {
                loader.classList.remove(visibleClass);
            }
        }, settlingDelayMs);
    }

    function trackStart() {
        activeRequests += 1;
        showLoader();
    }

    function trackEnd() {
        activeRequests = Math.max(0, activeRequests - 1);
        hideLoader();
    }

    function trackPromise(promise) {
        trackStart();
        return promise.finally(trackEnd);
    }

    function patchWebSocket() {
        if (!window.WebSocket || window.WebSocket.__technochatNetworkLoader) {
            return;
        }

        const OriginalWebSocket = window.WebSocket;

        function TrackedWebSocket(url, protocols) {
            const socket = protocols === undefined
                ? new OriginalWebSocket(url)
                : new OriginalWebSocket(url, protocols);
            let isConnecting = true;

            function finishConnecting() {
                if (!isConnecting) {
                    return;
                }

                isConnecting = false;
                trackEnd();
            }

            trackStart();
            socket.addEventListener('open', finishConnecting);
            socket.addEventListener('error', finishConnecting);
            socket.addEventListener('close', finishConnecting);

            return socket;
        }

        TrackedWebSocket.prototype = OriginalWebSocket.prototype;
        TrackedWebSocket.CONNECTING = OriginalWebSocket.CONNECTING;
        TrackedWebSocket.OPEN = OriginalWebSocket.OPEN;
        TrackedWebSocket.CLOSING = OriginalWebSocket.CLOSING;
        TrackedWebSocket.CLOSED = OriginalWebSocket.CLOSED;
        TrackedWebSocket.__technochatNetworkLoader = true;
        window.WebSocket = TrackedWebSocket;
    }

    function patchSameWindowNavigation() {
        if (window.__technochatNavigationLoader) {
            return;
        }

        window.__technochatNavigationLoader = true;
        document.addEventListener('click', function(event) {
            if (event.defaultPrevented || event.button !== 0 ||
                event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
                return;
            }

            const link = event.target.closest && event.target.closest('a[href]');
            if (!link || link.hasAttribute('download')) {
                return;
            }

            const href = link.getAttribute('href');
            if (!href || href === '#') {
                return;
            }

            const target = (link.getAttribute('target') || '').toLowerCase();
            if (target && target !== '_self') {
                return;
            }

            const url = new URL(link.href, window.location.href);
            if (url.origin !== window.location.origin) {
                return;
            }

            if (url.pathname === window.location.pathname &&
                url.search === window.location.search &&
                url.hash) {
                return;
            }

            trackStart();
        }, true);
    }

    function patchFetch() {
        if (!window.fetch || window.fetch.__technochatNetworkLoader) {
            return;
        }

        const originalFetch = window.fetch.bind(window);
        const trackedFetch = function () {
            return trackPromise(originalFetch.apply(null, arguments));
        };

        trackedFetch.__technochatNetworkLoader = true;
        window.fetch = trackedFetch;
    }

    function patchJQueryAjax() {
        if (!window.jQuery || !window.jQuery.ajax || window.jQuery.ajax.__technochatNetworkLoader) {
            return;
        }

        const originalAjax = window.jQuery.ajax;
        const trackedAjax = function () {
            trackStart();

            const request = originalAjax.apply(this, arguments);
            request.always(trackEnd);
            return request;
        };

        trackedAjax.__technochatNetworkLoader = true;
        window.jQuery.ajax = trackedAjax;
        window.$.ajax = trackedAjax;
    }

    function init() {
        window.TechnochatNetworkLoader = {
            start: trackStart,
            end: trackEnd,
        };

        patchFetch();
        patchJQueryAjax();
        patchWebSocket();
        patchSameWindowNavigation();

        if (document.body) {
            const loader = ensureLoader();
            if (loader && activeRequests > 0) {
                loader.classList.add(visibleClass);
            }
            return;
        }

        document.addEventListener('DOMContentLoaded', function() {
            const loader = ensureLoader();
            if (loader && activeRequests > 0) {
                loader.classList.add(visibleClass);
            }
        });
    }

    init();
})();
