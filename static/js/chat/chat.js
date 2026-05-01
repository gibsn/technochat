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

const NewMsgTitle = "New message!";
const TypingNotifyRateMs = 1000;
const TypingCleanupRateMs = 250;

window.onfocus = function() {
    pageTitleNotification.off();
}

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

        if (!id || !key) {
            this.okconnected = false;
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
    },
    methods: {
        setupEncryptedChat: async function(id, key) {
            var self = this;

            try {
                this.roomKey = key;
                this.encrypter = new Encrypter(new AESGCM128());
                await this.encrypter.setupWithKey(Base64ToArrayBuffer(key));
            } catch (e) {
                console.error('could not import chat key', e);
                this.okconnected = false;
                return;
            }

            var wsProtocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
            this.ws = new WebSocket(wsProtocol + window.location.host + '/api/v1/chat/connect?id=' + id);
            this.ws.addEventListener('open', function() {
                console.log('chat websocket opened for chat', id);
            });
            this.ws.addEventListener('message', function(e) {
                var msg = JSON.parse(e.data);
                console.log(msg);
                switch (msg.type){
                    case WSMsgTypeService:
                        if (msg.data.event_id == EventConnInitOk ){
                            self.name = msg.data.event_data;
                            self.username = msg.data.event_data;
                        }
                        if (msg.data.event_id == EventConnInitNoSuchChat || msg.data.event_id == EventConnInitMaxUsrsReached ){
                            self.okconnected = false;
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
            this.ws.addEventListener('error', function(e) {
                console.log('chat websocket error', e);
            });
            this.ws.addEventListener('close', function(e) {
                console.log('chat websocket closed', {
                    code: e.code,
                    reason: e.reason,
                    wasClean: e.wasClean,
                });
                self.okconnected = false;
            });
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
