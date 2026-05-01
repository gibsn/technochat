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

const NewMsgTitle = "New message!";

window.onfocus = function() {
    pageTitleNotification.off();
}

new Vue({
    el: '#app',

    data: {
        ws: null, // Our websocket
        newMsg: '', // Holds new messages to be sent to the server
        chatContent: '', // A running list of chat messages displayed on the screen
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
    },
    computed: {
        presenceLabel: function() {
            return this.presence.online + ' (' + this.presence.max + ') online';
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

            var ownMessageClass = this.isOwnMessage(username) ? ' chat-message--own' : '';
            this.chatContent += '<div class="chat-message' + ownMessageClass + '">'
                + '<div class="chip" >'
                + this.avatarMarkup(username)
                + this.escapeHtml(username)
                + '</div>'
                + '<div class="chat-message_body">'
                + emojione.toImage(this.escapeHtml(body))
                + '</div>'
                + '</div>';
            this.scrollToBottom();
        },
        send: async function () {
            if (this.newMsg != '') {
                var plaintext = $('<p>').html(this.newMsg).text();
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
            return $('<div>').text(value == null ? '' : String(value)).html();
        },
        isOwnMessage: function(username) {
            return Boolean(this.name) && username === this.name;
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
