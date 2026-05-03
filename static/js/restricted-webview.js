export function isTelegramWebView() {
    var userAgent = window.navigator.userAgent || '';

    return Boolean(window.Telegram && window.Telegram.WebApp) || /Telegram/i.test(userAgent);
}

export function installRestrictedWebViewWarning() {
    if (!isTelegramWebView() || document.querySelector('.webview_warning')) {
        return;
    }

    var warning = document.createElement('div');
    warning.className = 'webview_warning';
    warning.setAttribute('role', 'status');
    warning.textContent = 'This chat may not reconnect correctly inside Telegram. Open it in Safari or Chrome.';

    document.body.prepend(warning);
}
