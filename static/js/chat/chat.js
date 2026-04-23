const WSMsgTypeService  = 0;
const WSMsgTypeMessage = 1;

const EventConnInitOk = 0;
const EventConnInitNoSuchChat = 1;
const EventConnInitMaxUsrsReached = 2;

const NewMsgTitle = "New message!";

// window.onfocus = function() {
//     pageTitleNotification.off();
// }
//
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
    },
    created: function() {
        var self = this;
        var id = getParameterByName('id', window.location) 
        this.ws = new WebSocket('wss://' + window.location.host + '/api/v1/chat/connect?id='+id);
        this.ws.addEventListener('message', function(e) {
            var msg = JSON.parse(e.data);
            console.log(msg);
            switch (msg.type){
                case WSMsgTypeService:
                    if (msg.data.event_id == EventConnInitOk ){
                        self.name = msg.event_data;
                    }
                    if (msg.data.event_id == EventConnInitNoSuchChat || msg.data.event_id == EventConnInitMaxUsrsReached ){
                        self.okconnected = false;
                    }
                    break
                case WSMsgTypeMessage:
                    self.addmsg(msg);
                    break
                default:
                    alert("unknown response type:"+msg.type);
            }
        });
        this.ws.addEventListener('close', function() {
            self.okconnected = false;
        });
    },
    methods: {
        addmsg: function(msg){
            // if (document.hidden) {
            //     pageTitleNotification.on(NewMsgTitle);
            // }
            var username = msg.username || '';
            this.chatContent += '<div class="chat-message">'
                + '<div class="chip" >'
                + this.avatarMarkup(username)
                + this.escapeHtml(username)
                + '</div>'
                + '<div class="chat-message_body">'
                + emojione.toImage(msg.data) // Parse emojis
                + '</div>'
                + '</div>';
            this.scrollToBottom();
        },
        send: function () {
            if (this.newMsg != '') {
                this.ws.send(
                    JSON.stringify({
                        type:1,
                        username: this.username,
                        data: $('<p>').html(this.newMsg).text() // Strip out html
                    }
                ));
                this.newMsg = ''; // Reset newMsg
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
        escapeHtml: function(value) {
            return $('<div>').text(value == null ? '' : String(value)).html();
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
