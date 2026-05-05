const chatSessionPrefix = 'technochat:chat:';

export function reconnectStorageKey(chatID) {
    return chatSessionPrefix + chatID;
}

export function reconnectSessionLink(session) {
    return '/html/joinchat.html?id=' + encodeURIComponent(session.chatId) +
        '#key=' + encodeURIComponent(session.roomKey);
}

export function loadReconnectSession(chatID) {
    try {
        var raw = window.localStorage.getItem(reconnectStorageKey(chatID));
        if (!raw) {
            return emptyReconnectSession();
        }

        return normalizeReconnectSession(JSON.parse(raw));
    } catch (e) {
        console.warn('could not load chat session', e);
        return emptyReconnectSession();
    }
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
        window.localStorage.setItem(reconnectStorageKey(chatID), JSON.stringify({
            chatId: chatID,
            reconnectToken: reconnectToken,
            name: name || '',
            roomKey: roomKey || '',
            updatedAt: new Date().toISOString(),
        }));
    } catch (e) {
        console.warn('could not store chat session', e);
    }
}

export function storeReconnectRoomKey(chatID, roomKey) {
    if (!chatID || !roomKey) {
        return;
    }

    try {
        var session = loadReconnectSession(chatID);
        window.localStorage.setItem(reconnectStorageKey(chatID), JSON.stringify({
            chatId: chatID,
            reconnectToken: session.reconnectToken || '',
            name: session.name || '',
            roomKey: roomKey,
            updatedAt: new Date().toISOString(),
        }));
    } catch (e) {
        console.warn('could not store chat room key', e);
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
