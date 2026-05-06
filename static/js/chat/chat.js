import {
    AESGCM128,
    Base64ToArrayBuffer,
    Decrypter,
    Encrypter
} from "/js/message/crypto.js";
import {
    clearReconnectToken,
    clearReconnectSession,
    inspectReconnectSession,
    loadReconnectSession,
    storeReconnectRoomKey,
    storeReconnectSession
} from "/js/chat/reconnect-session.js";
import {
    currentPushSubscription,
    preloadVAPIDPublicKey,
    pushPermission,
    pushSupported
} from "/js/chat/push-subscription.js";
import {
    deletePushMessages,
    readPushMessages
} from "/js/chat/push-messages.js";
import {installRestrictedWebViewWarning} from "/js/restricted-webview.js";

const WSMsgTypeService  = 0;
const WSMsgTypeMessage = 1;

const EventConnInitOk = 0;
const EventConnInitNoSuchChat = 1;
const EventConnInitMaxUsrsReached = 2;
const EventPresence = 3;
const EventTyping = 4;
const EventConnInitInvalidReconnectToken = 5;
const EventPushSubscribe = 6;
const EventPushUnsubscribe = 7;

const NewMsgTitle = "New message!";
const TypingNotifyRateMs = 1000;
const TypingCleanupRateMs = 250;
const InitialConnectRetryDelaysMs = [500, 1000];
const ReconnectDelaysMs = [1000, 2000, 5000, 10000, 30000];
const ReconnectSessionStoreRetryDelaysMs = [1000, 2000, 5000, 10000, 30000];
const DiagnosticPageID = createDiagnosticPageID();
var diagnosticSequence = 0;
var diagnosticParticipantName = '';

window.onfocus = function() {
    pageTitleNotification.off();
}

function isStandalonePWA() {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
        window.navigator.standalone === true;
}

function isIOSBrowser() {
    var ua = window.navigator.userAgent || '';
    var platform = window.navigator.platform || '';

    return /iPad|iPhone|iPod/.test(ua) ||
        (platform === 'MacIntel' && window.navigator.maxTouchPoints > 1);
}

function shouldPromptIOSHomeScreen() {
    return isIOSBrowser() && !isStandalonePWA();
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
    if (diagnosticParticipantName) {
        context.participant_name = diagnosticParticipantName;
    }

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

function setDiagnosticParticipantName(name) {
    diagnosticParticipantName = name || '';
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

function reconnectSessionInspectionDiagnostic(inspection) {
    var session = inspection && inspection.session ? inspection.session : {};

    return {
        storage_accessible: Boolean(inspection && inspection.storageAccessible),
        local_storage_length: inspection ? inspection.localStorageLength : 0,
        storage_key_present: Boolean(inspection && inspection.rawPresent),
        storage_record_length: inspection ? inspection.rawLength : 0,
        storage_record_parseable: Boolean(inspection && inspection.parseable),
        storage_record_updated_at: session.updatedAt || '',
        stored_session_present: Boolean(session.chatId),
        stored_has_key: Boolean(session.roomKey),
        stored_has_reconnect_token: Boolean(session.reconnectToken),
        storage_error_name: inspection ? inspection.storageErrorName : '',
        storage_error_message: inspection ? inspection.storageErrorMessage : '',
        storage_parse_error_name: inspection ? inspection.parseErrorName : '',
        storage_parse_error_message: inspection ? inspection.parseErrorMessage : '',
    };
}

function reconnectSessionStoreRetryDelay(attempt) {
    return ReconnectSessionStoreRetryDelaysMs[
        Math.min(attempt - 1, ReconnectSessionStoreRetryDelaysMs.length - 1)
    ];
}

function delay(ms) {
    return new Promise(function(resolve) {
        window.setTimeout(resolve, ms);
    });
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
installRestrictedWebViewWarning();

new Vue({
    el: '#app',

    data: {
        ws: null, // Our websocket
        newMsg: '', // Holds new messages to be sent to the server
        chatMessages: [],
        renderedMessageIDs: {},
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
        reconnectDeferredWhileHidden: false,
        reconnectDeferredUseReconnect: false,
        connectionStatus: '',
        chatFinished: false,
        manualReconnectAvailable: false,
        pushSubscription: null,
        pushSupported: pushSupported(),
        pushPermission: pushPermission(),
        pushSubscriptionChangeHandler: null,
        pushPermissionGestureHandler: null,
        reconnectSessionPersisted: false,
        reconnectSessionPersistAttempts: 0,
        iosHomePromptVisible: false,
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
        var keySource = key ? 'hash' : 'missing';
        var session = null;
        var sessionInspection = null;

        if (id) {
            sessionInspection = inspectReconnectSession(id);
            session = sessionInspection.session;
            if (key) {
                var roomKeyStoreResult = storeReconnectRoomKey(id, key);
                sessionInspection = roomKeyStoreResult && roomKeyStoreResult.inspection ?
                    roomKeyStoreResult.inspection :
                    inspectReconnectSession(id);
                session = sessionInspection.session;
                if (!roomKeyStoreResult || !roomKeyStoreResult.ok) {
                    reportChatDiagnostic('chat_reconnect_room_key_store_failed', Object.assign({
                        chat_id: id,
                        error_name: roomKeyStoreResult ? roomKeyStoreResult.errorName : '',
                        error_message: roomKeyStoreResult ? roomKeyStoreResult.errorMessage : '',
                    }, reconnectSessionInspectionDiagnostic(sessionInspection)));
                }
            } else {
                key = session.roomKey;
                keySource = key ? 'storage' : 'missing';
            }
        }

        reportChatDiagnostic('chat_join_page_start', Object.assign({
            chat_id: id || '',
            has_id: Boolean(id),
            key_length: key ? key.length : 0,
            key_mod4: key ? key.length % 4 : null,
            key_source: keySource,
        }, reconnectSessionInspectionDiagnostic(sessionInspection)));

        if (!id || !key) {
            reportChatDiagnostic('chat_join_params_missing', Object.assign({
                chat_id: id || '',
                has_id: Boolean(id),
                missing_id: !id,
                missing_key: !key,
                key_source: keySource,
            }, reconnectSessionInspectionDiagnostic(sessionInspection)));
            this.okconnected = false;
            this.connectionStatus = 'Chat link is invalid';
            return;
        }

        if (keySource === 'storage' && !(session && session.reconnectToken)) {
            reportChatDiagnostic('chat_join_reconnect_token_missing', Object.assign({
                chat_id: id || '',
                has_id: Boolean(id),
                key_source: keySource,
                stored_has_reconnect_token: false,
            }, reconnectSessionInspectionDiagnostic(sessionInspection)));
            this.okconnected = false;
            this.connectionStatus = 'Could not reconnect';
            return;
        }

        this.setupEncryptedChat(id, key);
    },
    mounted: function() {
        var self = this;
        this.typingCleanupTimer = window.setInterval(function() {
            self.cleanupExpiredTypingUsers();
        }, TypingCleanupRateMs);
        if ('serviceWorker' in navigator) {
            this.pushSubscriptionChangeHandler = function(event) {
                if (!event.data || event.data.type !== 'technochat:push-subscription-changed') {
                    return;
                }

                self.pushSubscription = event.data.subscription || null;
                self.pushPermission = pushPermission();
                self.sendPushSubscription();
                reportChatDiagnostic('chat_push_subscription_changed', {
                    chat_id: self.chatID,
                    has_subscription: Boolean(self.pushSubscription),
                    permission: self.pushPermission,
                });
            };
            navigator.serviceWorker.addEventListener('message', this.pushSubscriptionChangeHandler);
        }
        if (this.pushSupported) {
            preloadVAPIDPublicKey().catch(function(e) {
                console.warn('could not preload VAPID public key', e);
            });
        }
        document.addEventListener('visibilitychange', this.resumeDeferredReconnect);
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
        if ('serviceWorker' in navigator && this.pushSubscriptionChangeHandler) {
            navigator.serviceWorker.removeEventListener('message', this.pushSubscriptionChangeHandler);
        }
        document.removeEventListener('visibilitychange', this.resumeDeferredReconnect);
        this.uninstallPushPermissionGestureHandler();
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

            var session = loadReconnectSession(id);
            this.reconnectToken = session.reconnectToken;
            this.reconnectSessionPersisted = Boolean(session.roomKey && session.reconnectToken);
            if (session.name) {
                this.name = session.name;
                this.username = session.name;
                setDiagnosticParticipantName(session.name);
            }
            await this.renderStoredPushMessages();
            var vapidPublicKey = '';
            try {
                vapidPublicKey = await preloadVAPIDPublicKey();
            } catch (e) {
                console.warn('could not preload VAPID public key', e);
            }
            await this.refreshPushSubscription(false);
            if (!this.reconnectToken && shouldPromptIOSHomeScreen()) {
                this.iosHomePromptVisible = true;
                reportChatDiagnostic('chat_ios_home_prompt_shown', {
                    chat_id: this.chatID,
                });
                return;
            }

            if (vapidPublicKey) {
                this.installPushPermissionGestureHandler();
            }
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
            this.manualReconnectAvailable = false;
            this.connectionStatus = useReconnect ? this.reconnectingStatus() : '';
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
                            self.finishChat('Chat not found');
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
                            clearReconnectToken(self.chatID, self.roomKey);
                            self.reconnectToken = '';
                            self.stopConnecting('Could not reconnect', true);
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
                if (document.visibilityState === 'hidden') {
                    self.deferReconnectUntilVisible(Boolean(self.reconnectToken || useReconnect));
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
            var self = this;
            var name = data;
            var reconnectToken = '';

            if (data && typeof data === 'object') {
                name = data.name;
                reconnectToken = data.reconnect_token || '';
            }

            this.name = name;
            this.username = name;
            setDiagnosticParticipantName(name);
            this.okconnected = true;
            this.connectionStatus = '';
            this.chatFinished = false;
            this.manualReconnectAvailable = false;
            this.reconnectAttempt = 0;

            if (reconnectToken) {
                this.reconnectToken = reconnectToken;
                this.reconnectSessionPersisted = false;
                this.persistReconnectSessionUntilStored(reconnectToken, name).then(function() {
                    self.sendPushSubscription();
                });
                return;
            }

            this.sendPushSubscription();
        },
        persistReconnectSessionUntilStored: async function(reconnectToken, name) {
            var attempt = 1;

            for (;;) {
                this.reconnectSessionPersistAttempts = attempt;
                var result = storeReconnectSession(this.chatID, reconnectToken, name, this.roomKey);
                if (result && result.ok) {
                    this.reconnectSessionPersisted = true;
                    reportChatDiagnostic('chat_reconnect_session_store_ok', Object.assign({
                        chat_id: this.chatID,
                        attempts: attempt,
                    }, reconnectSessionInspectionDiagnostic(result.inspection)));
                    return;
                }

                this.reconnectSessionPersisted = false;
                var retryDelay = reconnectSessionStoreRetryDelay(attempt);
                reportChatDiagnostic('chat_reconnect_session_store_failed', Object.assign({
                    chat_id: this.chatID,
                    attempts: attempt,
                    retry_delay_ms: retryDelay,
                    error_name: result ? result.errorName : '',
                    error_message: result ? result.errorMessage : 'unknown reconnect session storage error',
                }, reconnectSessionInspectionDiagnostic(result && result.inspection)));
                await delay(retryDelay);
                attempt++;
            }
        },
        refreshPushSubscription: async function(requestPermission) {
            if (!this.pushSupported) {
                return;
            }

            try {
                this.pushSubscription = await currentPushSubscription(requestPermission);
                this.pushPermission = pushPermission();
                if (this.pushSubscription || this.pushPermission !== 'default') {
                    this.uninstallPushPermissionGestureHandler();
                }
            } catch (e) {
                console.warn('could not refresh push subscription', e);
                reportChatDiagnostic('chat_push_subscription_failed', Object.assign({
                    chat_id: this.chatID,
                    request_permission: Boolean(requestPermission),
                    permission: pushPermission(),
                }, errorDiagnostic(e)));
                this.pushSubscription = null;
                this.pushPermission = pushPermission();
            }
        },
        installPushPermissionGestureHandler: function() {
            var self = this;
            if (!this.pushSupported || this.pushPermission !== 'default' || this.pushPermissionGestureHandler) {
                return;
            }

            this.pushPermissionGestureHandler = function() {
                self.refreshPushSubscription(true).then(function() {
                    self.sendPushSubscription();
                });
            };

            document.addEventListener('click', this.pushPermissionGestureHandler, { once: true });
            document.addEventListener('keydown', this.pushPermissionGestureHandler, { once: true });
            document.addEventListener('touchend', this.pushPermissionGestureHandler, { once: true });
        },
        uninstallPushPermissionGestureHandler: function() {
            if (!this.pushPermissionGestureHandler) {
                return;
            }

            document.removeEventListener('click', this.pushPermissionGestureHandler);
            document.removeEventListener('keydown', this.pushPermissionGestureHandler);
            document.removeEventListener('touchend', this.pushPermissionGestureHandler);
            this.pushPermissionGestureHandler = null;
        },
        sendPushSubscription: function() {
            if (!this.pushSubscription || !this.ws || this.ws.readyState !== 1) {
                return;
            }
            if (!this.reconnectToken || !this.reconnectSessionPersisted) {
                reportChatDiagnostic('chat_push_subscription_blocked_until_reconnect_session_stored', {
                    chat_id: this.chatID,
                    has_reconnect_token: Boolean(this.reconnectToken),
                    reconnect_session_persisted: this.reconnectSessionPersisted,
                    reconnect_session_persist_attempts: this.reconnectSessionPersistAttempts,
                    permission: this.pushPermission,
                });
                return;
            }

            this.ws.send(JSON.stringify({
                type: WSMsgTypeService,
                data: {
                    event_id: EventPushSubscribe,
                    event_data: this.pushSubscription,
                },
            }));
        },
        reconnectingStatus: function() {
            if (this.name) {
                return 'Reconnecting as ' + this.name + '...';
            }

            return 'Reconnecting...';
        },
        deferReconnectUntilVisible: function(useReconnect) {
            this.reconnectDeferredWhileHidden = true;
            this.reconnectDeferredUseReconnect = Boolean(useReconnect);
            reportChatDiagnostic('chat_ws_reconnect_deferred_hidden', {
                chat_id: this.chatID,
                mode: useReconnect ? 'reconnect' : 'connect',
                reconnect_attempt: this.reconnectAttempt,
            });
        },
        resumeDeferredReconnect: function() {
            if (document.visibilityState !== 'visible' || !this.reconnectDeferredWhileHidden) {
                return;
            }

            var useReconnect = this.reconnectDeferredUseReconnect;
            this.reconnectDeferredWhileHidden = false;
            this.reconnectDeferredUseReconnect = false;
            this.connectionStatus = useReconnect ? this.reconnectingStatus() : 'Connecting...';
            reportChatDiagnostic('chat_ws_reconnect_resumed_visible', {
                chat_id: this.chatID,
                mode: useReconnect ? 'reconnect' : 'connect',
                reconnect_attempt: this.reconnectAttempt,
            });
            this.openChatSocket(useReconnect);
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
                this.stopConnecting('Connection lost', false, true);
                return;
            }

            var retryDelays = useReconnect ? ReconnectDelaysMs : InitialConnectRetryDelaysMs;
            var delay = retryDelays[Math.min(this.reconnectAttempt, retryDelays.length - 1)];
            this.reconnectAttempt++;
            this.connectionStatus = useReconnect ? this.reconnectingStatus() : 'Connecting...';

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
        manualReconnect: function() {
            if (this.reconnectTimer) {
                window.clearTimeout(this.reconnectTimer);
                this.reconnectTimer = null;
            }
            this.reconnectDeferredWhileHidden = false;
            this.reconnectDeferredUseReconnect = false;

            reportChatDiagnostic('chat_manual_reconnect', {
                chat_id: this.chatID,
                has_reconnect_token: Boolean(this.reconnectToken),
            });

            this.chatFinished = false;
            this.manualReconnectAvailable = false;
            this.reconnectAttempt = 0;
            this.okconnected = true;
            this.connectionStatus = this.reconnectToken ? this.reconnectingStatus() : 'Connecting...';
            this.openChatSocket(Boolean(this.reconnectToken));
        },
        continueWithoutIOSPush: function() {
            this.iosHomePromptVisible = false;
            this.okconnected = true;
            this.connectionStatus = 'Connecting...';
            reportChatDiagnostic('chat_ios_home_prompt_skipped', {
                chat_id: this.chatID,
            });
            this.installPushPermissionGestureHandler();
            this.openChatSocket(false);
        },
        stopConnecting: function(status, terminal, manualReconnectAvailable) {
            if (this.reconnectTimer) {
                window.clearTimeout(this.reconnectTimer);
                this.reconnectTimer = null;
            }
            if (terminal) {
                this.chatFinished = true;
            }
            this.connectionStatus = status;
            this.manualReconnectAvailable = Boolean(manualReconnectAvailable);
            this.okconnected = false;
        },
        finishChat: function(status) {
            this.chatFinished = true;
            clearReconnectSession(this.chatID);
            this.reconnectToken = '';
            this.stopConnecting(status);
        },
        leaveChat: function() {
            if (this.reconnectTimer) {
                window.clearTimeout(this.reconnectTimer);
                this.reconnectTimer = null;
            }

            reportChatDiagnostic('chat_leave_local', {
                chat_id: this.chatID,
                has_reconnect_token: Boolean(this.reconnectToken),
            });

            this.chatFinished = true;
            clearReconnectSession(this.chatID);
            this.reconnectToken = '';
            this.manualReconnectAvailable = false;
            this.reconnectDeferredWhileHidden = false;
            this.reconnectDeferredUseReconnect = false;

            if (this.ws) {
                var socket = this.ws;
                this.ws = null;
                if (socket.readyState === 1) {
                    socket.send(JSON.stringify({
                        type: WSMsgTypeService,
                        data: {
                            event_id: EventPushUnsubscribe,
                        },
                    }));
                }
                socket.close();
            }

            window.location.href = '/html/messageadd.html';
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
        renderStoredPushMessages: async function() {
            var messages;

            try {
                messages = await readPushMessages(this.chatID);
            } catch (e) {
                console.warn('could not read stored push messages', e);
                return;
            }

            var renderedIDs = [];
            for (var i = 0; i < messages.length; i++) {
                var messageID = messages[i].messageId;
                await this.addmsg({
                    type: WSMsgTypeMessage,
                    username: messages[i].sender,
                    data: messages[i].data,
                    created_at: messages[i].timestamp,
                    message_id: messageID,
                    message_seq: messages[i].messageSeq,
                });
                renderedIDs.push(messageID);
            }

            try {
                await deletePushMessages(this.chatID, renderedIDs);
            } catch (e) {
                console.warn('could not delete stored push messages', e);
            }
        },
        addmsg: async function(msg){
            if (msg.message_id) {
                if (this.renderedMessageIDs[msg.message_id]) {
                    return;
                }
                this.$set(this.renderedMessageIDs, msg.message_id, true);
            }

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
