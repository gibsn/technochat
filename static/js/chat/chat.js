import {
    AESGCM128,
    Base64ToArrayBuffer,
    Decrypter,
    Encrypter
} from "/js/message/crypto.js";

const WSMsgTypeService  = 0;
const WSMsgTypeMessage = 1;

const EventConnInitOk = 0;
const EventConnInitNoSuchChat = 1;
const EventConnInitMaxUsrsReached = 2;
const EventPresence = 3;
const EventTyping = 4;
const EventConnInitInvalidReconnectToken = 5;

const NewMsgTitle = "New message!";
const TypingNotifyRateMs = 1000;
const TypingCleanupRateMs = 250;
const InitialConnectRetryDelaysMs = [500, 1000];
const ReconnectDelaysMs = [1000, 2000, 5000, 10000, 30000];
const DiagnosticPageID = createDiagnosticPageID();
var diagnosticSequence = 0;

window.onfocus = function() {
    pageTitleNotification.off();
}

function isStandalonePWA() {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
        window.navigator.standalone === true;
}

function createDiagnosticPageID() {
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

function diagnosticContext(extra) {
    var hashParams = new URLSearchParams(window.location.hash.slice(1));
    var context = {
        path: window.location.pathname,
        search: window.location.search,
        hash_present: window.location.hash.length > 0,
        has_key: hashParams.has('key'),
        standalone: isStandalonePWA(),
        online: window.navigator.onLine,
        visibility_state: document.visibilityState,
    };

    Object.keys(extra || {}).forEach(function(key) {
        context[key] = extra[key];
    });

    context.client_ts = new Date().toISOString();
    context.page_id = DiagnosticPageID;
    context.seq = ++diagnosticSequence;

    return context;
}

function reportChatDiagnostic(eventName, data) {
    var payload = JSON.stringify({
        event: eventName,
        data: diagnosticContext(data),
    });

    try {
        if (window.navigator.sendBeacon) {
            var blob = new Blob([payload], { type: 'application/json' });
            if (window.navigator.sendBeacon('/api/v1/client/log', blob)) {
                return;
            }
        }
    } catch (err) {
        console.warn('could not send chat diagnostic beacon', err);
    }

    if (!window.fetch) {
        return;
    }

    window.fetch('/api/v1/client/log', {
        method: 'POST',
        body: payload,
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
    }).catch(function(err) {
        console.warn('could not send chat diagnostic fetch', err);
    });
}

function errorDiagnostic(error) {
    if (!error) {
        return {};
    }

    return {
        error_name: error.name || '',
        error_message: error.message || String(error),
    };
}

function installPageLifecycleDiagnostics() {
    window.addEventListener('pagehide', function(event) {
        reportChatDiagnostic('chat_page_hide', {
            persisted: event.persisted,
        });
    });

    window.addEventListener('beforeunload', function() {
        reportChatDiagnostic('chat_before_unload', {});
    });

    document.addEventListener('visibilitychange', function() {
        reportChatDiagnostic('chat_visibility_change', {});
    });
}

installPageLifecycleDiagnostics();

new Vue({
    el: '#app',

    data: {
        ws: null, // Our websocket
        newMsg: '', // Holds new messages to be sent to the server
        chatMessages: [],
        nextChatMessageID: 1,
        username: null, // Our username
        okconnected: true, // True if email and username have been filled in
        fail: false,
        name: '',
        onPage: false,
        newMessagesNum: 0,
        roomKey: '',
        encrypter: null,
        presence: {
            online: 0,
            max: 0,
            users: [],
        },
        presenceOpen: false,
        typingUsers: [],
        typingCleanupTimer: null,
        lastTypingSentAt: 0,
        chatID: '',
        reconnectToken: '',
        reconnectTimer: null,
        reconnectAttempt: 0,
        connectionStatus: '',
        chatFinished: false,
    },
    computed: {
        presenceLabel: function() {
            return this.presence.online + ' (' + this.presence.max + ') online';
        },
        typingText: function() {
            if (this.typingUsers.length === 0) {
                return '';
            }

            var names = this.typingUsers.map(function(user) {
                return user.name;
            });

            if (names.length === 1) {
                return names[0] + ' is typing';
            }
            if (names.length === 2) {
                return names[0] + ' and ' + names[1] + ' are typing';
            }

            return names[0] + ', ' + names[1] + ' and ' + (names.length - 2) + ' others are typing';
        },
    },
    created: function() {
        var id = getParameterByName('id', window.location);
        var anchorParams = new URLSearchParams(window.location.hash.slice(1));
        var key = anchorParams.get('key');

        reportChatDiagnostic('chat_join_page_start', {
            chat_id: id || '',
            has_id: Boolean(id),
            key_length: key ? key.length : 0,
            key_mod4: key ? key.length % 4 : null,
        });

        if (!id || !key) {
            reportChatDiagnostic('chat_join_params_missing', {
                chat_id: id || '',
                has_id: Boolean(id),
                missing_id: !id,
                missing_key: !key,
            });
            this.okconnected = false;
            this.connectionStatus = 'Chat link is invalid';
            return;
        }

        this.setupEncryptedChat(id, key);
    },
    mounted: function() {
        var self = this;
        this.typingCleanupTimer = window.setInterval(function() {
            self.cleanupExpiredTypingUsers();
        }, TypingCleanupRateMs);
    },
    beforeDestroy: function() {
        if (this.typingCleanupTimer) {
            window.clearInterval(this.typingCleanupTimer);
        }
        if (this.reconnectTimer) {
            window.clearTimeout(this.reconnectTimer);
        }
        if (this.ws) {
            this.ws.close();
        }
    },
    methods: {
        setupEncryptedChat: async function(id, key) {
            try {
                this.chatID = id;
                this.roomKey = key;
                this.encrypter = new Encrypter(new AESGCM128());
                await this.encrypter.setupWithKey(Base64ToArrayBuffer(key));
            } catch (e) {
                console.error('could not import chat key', e);
                reportChatDiagnostic('chat_key_import_failed', Object.assign({
                    chat_id: id,
                    key_length: key.length,
                    key_mod4: key.length % 4,
                }, errorDiagnostic(e)));
                this.okconnected = false;
                this.connectionStatus = 'Chat link is invalid';
                return;
            }

            this.reconnectToken = this.loadReconnectToken(id);
            this.openChatSocket(Boolean(this.reconnectToken));
        },
        openChatSocket: function(useReconnect) {
            var self = this;
            var wsProtocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
            var path = useReconnect ? '/api/v1/chat/reconnect' : '/api/v1/chat/connect';
            var wsURL = wsProtocol + window.location.host + path + '?id=' + encodeURIComponent(this.chatID);
            if (useReconnect) {
                wsURL += '&reconnect_token=' + encodeURIComponent(this.reconnectToken);
            }

            reportChatDiagnostic('chat_ws_connect_start', {
                chat_id: this.chatID,
                mode: useReconnect ? 'reconnect' : 'connect',
                ws_protocol: wsProtocol,
                reconnect_attempt: this.reconnectAttempt,
                has_reconnect_token: Boolean(this.reconnectToken),
            });

            var socket;
            try {
                socket = new WebSocket(wsURL);
            } catch (e) {
                console.error('could not create chat websocket', e);
                reportChatDiagnostic('chat_ws_create_failed', Object.assign({
                    chat_id: this.chatID,
                    mode: useReconnect ? 'reconnect' : 'connect',
                    ws_protocol: wsProtocol,
                    reconnect_attempt: this.reconnectAttempt,
                }, errorDiagnostic(e)));
                if (this.reconnectToken) {
                    this.scheduleReconnect(true);
                    return;
                }

                this.scheduleReconnect(false);
                return;
            }

            this.ws = socket;
            this.connectionStatus = useReconnect ? 'Reconnecting...' : '';
            var wsOpened = false;
            socket.addEventListener('open', function() {
                wsOpened = true;
                console.log('chat websocket opened for chat', self.chatID);
                reportChatDiagnostic('chat_ws_open', {
                    chat_id: self.chatID,
                    mode: useReconnect ? 'reconnect' : 'connect',
                    reconnect_attempt: self.reconnectAttempt,
                });
            });
            socket.addEventListener('message', function(e) {
                if (socket !== self.ws) {
                    return;
                }

                var msg = JSON.parse(e.data);
                console.log(msg);
                switch (msg.type){
                    case WSMsgTypeService:
                        if (msg.data.event_id == EventConnInitOk ){
                            self.handleConnInitOk(msg.data.event_data);
                        }
                        if (msg.data.event_id == EventConnInitNoSuchChat) {
                            reportChatDiagnostic('chat_ws_no_such_chat', {
                                chat_id: self.chatID,
                                mode: useReconnect ? 'reconnect' : 'connect',
                            });
                            self.finishChat('Chat finished');
                        }
                        if (msg.data.event_id == EventConnInitMaxUsrsReached ){
                            reportChatDiagnostic('chat_ws_chat_full', {
                                chat_id: self.chatID,
                                mode: useReconnect ? 'reconnect' : 'connect',
                            });
                            self.stopConnecting('Chat is full', true);
                        }
                        if (msg.data.event_id == EventConnInitInvalidReconnectToken) {
                            reportChatDiagnostic('chat_ws_invalid_reconnect_token', {
                                chat_id: self.chatID,
                                mode: useReconnect ? 'reconnect' : 'connect',
                            });
                            self.clearStoredReconnectToken(self.chatID);
                            self.reconnectToken = '';
                            if (useReconnect) {
                                self.reconnectAttempt = 0;
                                self.openChatSocket(false);
                            } else {
                                self.stopConnecting('Could not reconnect', true);
                            }
                        }
                        if (msg.data.event_id == EventPresence) {
                            self.updatePresence(msg.data.event_data);
                        }
                        if (msg.data.event_id == EventTyping) {
                            self.updateTypingUsers(msg.data.event_data);
                        }
                        break;
                    case WSMsgTypeMessage:
                        self.addmsg(msg);
                        break;
                    default:
                        alert("unknown response type:"+msg.type);
                }
            });
            socket.addEventListener('error', function(e) {
                console.log('chat websocket error', e);
                reportChatDiagnostic('chat_ws_error', {
                    chat_id: self.chatID,
                    mode: useReconnect ? 'reconnect' : 'connect',
                    ready_state: socket.readyState,
                    reconnect_attempt: self.reconnectAttempt,
                });
            });
            socket.addEventListener('close', function(e) {
                if (socket !== self.ws) {
                    return;
                }

                console.log('chat websocket closed', {
                    code: e.code,
                    reason: e.reason,
                    wasClean: e.wasClean,
                });
                reportChatDiagnostic('chat_ws_close', {
                    chat_id: self.chatID,
                    mode: useReconnect ? 'reconnect' : 'connect',
                    code: e.code,
                    reason: e.reason,
                    was_clean: e.wasClean,
                    opened: wsOpened,
                    reconnect_attempt: self.reconnectAttempt,
                });
                if (self.chatFinished) {
                    return;
                }
                if (self.reconnectToken) {
                    self.scheduleReconnect(true);
                    return;
                }
                if (!wsOpened) {
                    self.scheduleReconnect(false);
                    return;
                }

                self.stopConnecting('Connection lost');
            });
        },
        handleConnInitOk: function(data) {
            var name = data;
            var reconnectToken = '';

            if (data && typeof data === 'object') {
                name = data.name;
                reconnectToken = data.reconnect_token || '';
            }

            this.name = name;
            this.username = name;
            this.okconnected = true;
            this.connectionStatus = '';
            this.chatFinished = false;
            this.reconnectAttempt = 0;

            if (reconnectToken) {
                this.reconnectToken = reconnectToken;
                this.storeReconnectToken(this.chatID, reconnectToken);
            }
        },
        scheduleReconnect: function(useReconnect) {
            var self = this;

            if (this.reconnectTimer) {
                return;
            }

            if (!useReconnect && this.reconnectAttempt >= InitialConnectRetryDelaysMs.length) {
                reportChatDiagnostic('chat_ws_connect_failed', {
                    chat_id: this.chatID,
                    mode: 'connect',
                    attempts: this.reconnectAttempt + 1,
                });
                this.stopConnecting('Connection lost');
                return;
            }

            var retryDelays = useReconnect ? ReconnectDelaysMs : InitialConnectRetryDelaysMs;
            var delay = retryDelays[Math.min(this.reconnectAttempt, retryDelays.length - 1)];
            this.reconnectAttempt++;
            this.connectionStatus = useReconnect ? 'Reconnecting...' : 'Connecting...';

            reportChatDiagnostic('chat_ws_retry_scheduled', {
                chat_id: this.chatID,
                mode: useReconnect ? 'reconnect' : 'connect',
                attempts: this.reconnectAttempt,
                delay_ms: delay,
            });

            this.reconnectTimer = window.setTimeout(function() {
                self.reconnectTimer = null;
                self.openChatSocket(useReconnect);
            }, delay);
        },
        stopConnecting: function(status, terminal) {
            if (this.reconnectTimer) {
                window.clearTimeout(this.reconnectTimer);
                this.reconnectTimer = null;
            }
            if (terminal) {
                this.chatFinished = true;
            }
            this.connectionStatus = status;
            this.okconnected = false;
        },
        finishChat: function(status) {
            this.chatFinished = true;
            this.clearStoredReconnectToken(this.chatID);
            this.reconnectToken = '';
            this.stopConnecting(status);
        },
        reconnectStorageKey: function(chatID) {
            return 'technochat:chat:' + chatID;
        },
        loadReconnectToken: function(chatID) {
            try {
                var raw = window.localStorage.getItem(this.reconnectStorageKey(chatID));
                if (!raw) {
                    return '';
                }

                var session = JSON.parse(raw);
                return String(session.reconnectToken || '');
            } catch (e) {
                console.warn('could not load chat session', e);
                return '';
            }
        },
        storeReconnectToken: function(chatID, reconnectToken) {
            try {
                window.localStorage.setItem(this.reconnectStorageKey(chatID), JSON.stringify({
                    chatId: chatID,
                    reconnectToken: reconnectToken,
                }));
            } catch (e) {
                console.warn('could not store chat session', e);
            }
        },
        clearStoredReconnectToken: function(chatID) {
            try {
                window.localStorage.removeItem(this.reconnectStorageKey(chatID));
            } catch (e) {
                console.warn('could not clear chat session', e);
            }
        },
        decryptMessageData: async function(msg) {
            if (msg.username === 'server') {
                return String(msg.data || '');
            }

            if (!msg.data || msg.data.alg !== 'AES-GCM-128' || !msg.data.iv || !msg.data.ciphertext) {
                throw new Error('invalid encrypted payload');
            }

            var decrypter = new Decrypter(new AESGCM128());
            await decrypter.setup(
                Base64ToArrayBuffer(this.roomKey),
                Base64ToArrayBuffer(msg.data.iv)
            );

            return await decrypter.decryptToString(Base64ToArrayBuffer(msg.data.ciphertext));
        },
        addmsg: async function(msg){
            if (document.hidden) {
                pageTitleNotification.on(NewMsgTitle);
            }
            var username = msg.username || '';
            var body = '';

            try {
                body = await this.decryptMessageData(msg);
            } catch (e) {
                console.error('could not decrypt chat message', e);
                body = 'Could not decrypt chat message';
            }

            this.chatMessages.push({
                id: this.nextChatMessageID++,
                username: username,
                own: this.isOwnMessage(username),
                bodyHtml: emojione.toImage(this.escapeHtml(body)),
                timeISO: this.messageTimeISO(msg.created_at),
                timeLabel: this.messageTimeLabel(msg.created_at),
            });
            this.scrollToBottom();
        },
        send: async function () {
            if (this.newMsg != '') {
                if (!this.ws || this.ws.readyState !== 1) {
                    return;
                }

                var plaintext = this.newMsg;
                var encryptedData;

                try {
                    encryptedData = await this.encrypter.encryptStringWithNewIV(plaintext);
                } catch (e) {
                    console.error('could not encrypt chat message', e);
                    return;
                }

                this.ws.send(
                    JSON.stringify({
                        type:1,
                        username: this.username,
                        data: encryptedData
                    })
                );
                this.newMsg = '';
            }
        },
        notifyTyping: function() {
            if (!this.newMsg || !this.ws || this.ws.readyState !== 1) {
                return;
            }

            var now = Date.now();
            if (now - this.lastTypingSentAt < TypingNotifyRateMs) {
                return;
            }

            this.lastTypingSentAt = now;
            this.ws.send(JSON.stringify({
                type: WSMsgTypeService,
                data: {
                    event_id: EventTyping,
                },
            }));
        },
        scrollToBottom: function() {
            this.$nextTick(function() {
                var element = document.getElementById('chat-messages');
                if (!element) {
                    return;
                }
                element.scrollTop = element.scrollHeight;
            });
        },
        updatePresence: function(data) {
            var users = Array.isArray(data && data.users) ? data.users : [];

            this.presence = {
                online: Number(data && data.online) || users.length,
                max: Number(data && data.max) || 0,
                users: users.map(function(user) {
                    return {
                        id: user.id,
                        name: String(user.name || ''),
                    };
                }),
            };
        },
        openPresence: function() {
            this.presenceOpen = true;
        },
        closePresence: function() {
            this.presenceOpen = false;
        },
        updateTypingUsers: function(data) {
            var self = this;
            var users = Array.isArray(data) ? data : [];

            this.typingUsers = users.map(function(user) {
                return {
                    id: user.id,
                    name: String(user.name || ''),
                    expiresAt: Date.parse(user.expires_at),
                };
            }).filter(function(user) {
                return user.name && user.name !== self.name && Number.isFinite(user.expiresAt);
            });
            this.cleanupExpiredTypingUsers();
            this.scrollToBottom();
        },
        cleanupExpiredTypingUsers: function() {
            var now = Date.now();
            this.typingUsers = this.typingUsers.filter(function(user) {
                return user.expiresAt > now;
            });
        },
        avatarMarkup: function(username) {
            var safeUsername = this.escapeHtml(username);
            var fallback = this.fallbackAvatar(username);
            return '<img src="' + this.roboHash(username) + '" alt="' + safeUsername
                + '" loading="lazy" onerror="this.onerror=null;this.src=\'' + fallback + '\'">';
        },
        roboHash: function(username) {
            return 'https://robohash.org/' + encodeURIComponent(username) + '.png?size=50x50';
        },
        fallbackAvatar: function(username) {
            var letter = ((username || '?').trim().charAt(0) || '?').toUpperCase();
            var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50" viewBox="0 0 50 50">'
                + '<rect width="50" height="50" rx="25" fill="#111111"/>'
                + '<text x="50%" y="50%" dominant-baseline="central" text-anchor="middle" '
                + 'font-family="Ubuntu Mono, monospace" font-size="22" fill="#ffffff">' + letter + '</text>'
                + '</svg>';
            return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg);
        },
        useFallbackAvatar: function(event, username) {
            event.target.onerror = null;
            event.target.src = this.fallbackAvatar(username);
        },
        escapeHtml: function(value) {
            return String(value == null ? '' : value)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
        },
        isOwnMessage: function(username) {
            return Boolean(this.name) && username === this.name;
        },
        messageTimeISO: function(createdAt) {
            if (!createdAt) {
                return '';
            }

            var sentAt = new Date(createdAt);
            if (Number.isNaN(sentAt.getTime())) {
                return '';
            }

            return sentAt.toISOString();
        },
        messageTimeLabel: function(createdAt) {
            if (!createdAt) {
                return '';
            }

            var sentAt = new Date(createdAt);
            if (Number.isNaN(sentAt.getTime())) {
                return '';
            }

            return sentAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        },
    }
});

function getParameterByName(name, url) {
    if (!url) url = window.location.href;
    name = name.replace(/[\[\]]/g, "\\$&");
    var regex = new RegExp("[?&]" + name + "(=([^&#]*)|&|#|$)"),
        results = regex.exec(url);
    if (!results) return null;
    if (!results[2]) return '';
    return decodeURIComponent(results[2].replace(/\+/g, " "));
}
