const chatSessionPrefix = 'technochat:chat:';

export function reconnectStorageKey(chatID) {
    return chatSessionPrefix + chatID;
}

export function reconnectSessionLink(session) {
    return '/html/joinchat.html?id=' + encodeURIComponent(session.chatId) +
        '#key=' + encodeURIComponent(session.roomKey);
}

export function loadReconnectSession(chatID) {
    return inspectReconnectSession(chatID).session;
}

export function inspectReconnectSession(chatID) {
    var result = emptyReconnectSessionInspection();

    if (!chatID) {
        return result;
    }

    result.storageKey = reconnectStorageKey(chatID);

    try {
        result.localStorageLength = window.localStorage.length;
        var raw = window.localStorage.getItem(result.storageKey);
        result.rawPresent = Boolean(raw);
        result.rawLength = raw ? raw.length : 0;
        if (!raw) {
            return result;
        }

        try {
            result.session = normalizeReconnectSession(JSON.parse(raw));
            result.parseable = true;
        } catch (e) {
            result.parseable = false;
            result.parseErrorName = e.name || '';
            result.parseErrorMessage = e.message || String(e);
        }
    } catch (e) {
        console.warn('could not load chat session', e);
        result.storageAccessible = false;
        result.storageErrorName = e.name || '';
        result.storageErrorMessage = e.message || String(e);
    }

    return result;
}

export function loadReconnectSessions() {
    const sessions = [];

    try {
        for (let i = 0; i < window.localStorage.length; i++) {
            const storageKey = window.localStorage.key(i);
            if (!storageKey || !storageKey.startsWith(chatSessionPrefix)) {
                continue;
            }

            const raw = window.localStorage.getItem(storageKey);
            if (!raw) {
                continue;
            }

            try {
                const session = normalizeReconnectSession(JSON.parse(raw));
                if (!session.chatId || !session.reconnectToken || !session.roomKey) {
                    continue;
                }

                sessions.push(session);
            } catch (error) {
                console.warn('could not parse chat session', error);
            }
        }
    } catch (error) {
        console.warn('could not load chat sessions', error);
    }

    sessions.sort((left, right) => {
        return sessionTimestamp(right) - sessionTimestamp(left);
    });

    return sessions;
}

export function storeReconnectSession(chatID, reconnectToken, name, roomKey) {
    try {
        var expected = {
            chatId: chatID,
            reconnectToken: reconnectToken,
            name: name || '',
            roomKey: roomKey || '',
            updatedAt: new Date().toISOString(),
        };
        window.localStorage.setItem(reconnectStorageKey(chatID), JSON.stringify(expected));

        var stored = loadReconnectSession(chatID);
        if (
            stored.chatId !== expected.chatId ||
            stored.reconnectToken !== expected.reconnectToken ||
            stored.name !== expected.name ||
            stored.roomKey !== expected.roomKey
        ) {
            return {
                ok: false,
                errorName: 'StorageVerificationError',
                errorMessage: 'stored reconnect session did not match expected values',
                inspection: inspectReconnectSession(chatID),
            };
        }

        return {
            ok: true,
            session: stored,
            inspection: inspectReconnectSession(chatID),
        };
    } catch (e) {
        console.warn('could not store chat session', e);
        return {
            ok: false,
            errorName: e.name || '',
            errorMessage: e.message || String(e),
            inspection: inspectReconnectSession(chatID),
        };
    }
}

export function storeReconnectRoomKey(chatID, roomKey) {
    if (!chatID || !roomKey) {
        return {
            ok: false,
            errorName: 'InvalidReconnectRoomKey',
            errorMessage: 'chat id or room key is missing',
            inspection: inspectReconnectSession(chatID),
        };
    }

    try {
        var session = loadReconnectSession(chatID);
        var expected = {
            chatId: chatID,
            reconnectToken: session.reconnectToken || '',
            name: session.name || '',
            roomKey: roomKey,
            updatedAt: new Date().toISOString(),
        };
        window.localStorage.setItem(reconnectStorageKey(chatID), JSON.stringify(expected));

        var stored = loadReconnectSession(chatID);
        if (
            stored.chatId !== expected.chatId ||
            stored.reconnectToken !== expected.reconnectToken ||
            stored.name !== expected.name ||
            stored.roomKey !== expected.roomKey
        ) {
            return {
                ok: false,
                errorName: 'StorageVerificationError',
                errorMessage: 'stored reconnect room key did not match expected values',
                inspection: inspectReconnectSession(chatID),
            };
        }

        return {
            ok: true,
            session: stored,
            inspection: inspectReconnectSession(chatID),
        };
    } catch (e) {
        console.warn('could not store chat room key', e);
        return {
            ok: false,
            errorName: e.name || '',
            errorMessage: e.message || String(e),
            inspection: inspectReconnectSession(chatID),
        };
    }
}

export function clearReconnectToken(chatID, roomKey) {
    if (!chatID) {
        return;
    }

    try {
        var session = loadReconnectSession(chatID);
        var preservedRoomKey = roomKey || session.roomKey;
        if (!preservedRoomKey) {
            window.localStorage.removeItem(reconnectStorageKey(chatID));
            return;
        }

        window.localStorage.setItem(reconnectStorageKey(chatID), JSON.stringify({
            chatId: chatID,
            reconnectToken: '',
            name: session.name || '',
            roomKey: preservedRoomKey,
            updatedAt: new Date().toISOString(),
        }));
    } catch (e) {
        console.warn('could not clear chat reconnect token', e);
    }
}

export function clearReconnectSession(chatID) {
    try {
        window.localStorage.removeItem(reconnectStorageKey(chatID));
    } catch (e) {
        console.warn('could not clear chat session', e);
    }
}

function emptyReconnectSession() {
    return {
        chatId: '',
        reconnectToken: '',
        name: '',
        roomKey: '',
        updatedAt: '',
    };
}

function emptyReconnectSessionInspection() {
    return {
        session: emptyReconnectSession(),
        storageKey: '',
        storageAccessible: true,
        localStorageLength: 0,
        rawPresent: false,
        rawLength: 0,
        parseable: false,
        parseErrorName: '',
        parseErrorMessage: '',
        storageErrorName: '',
        storageErrorMessage: '',
    };
}

function normalizeReconnectSession(session) {
    return {
        chatId: String(session.chatId || ''),
        reconnectToken: String(session.reconnectToken || ''),
        name: String(session.name || ''),
        roomKey: String(session.roomKey || ''),
        updatedAt: String(session.updatedAt || ''),
    };
}

function sessionTimestamp(session) {
    const timestamp = Date.parse(session.updatedAt);
    return Number.isFinite(timestamp) ? timestamp : 0;
}
