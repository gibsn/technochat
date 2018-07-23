const WSMsgTypeService  = 0;
const WSMsgTypeMessage = 1;

const EventConnInitOk = 0;
const EventConnInitNoSuchChat = 1;
const EventConnInitMaxUsrsReached = 2;

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
            if (document.hidden) {
                pageTitleNotification.on(NewMsgTitle);
            }
            this.chatContent += '<div class="chip" >'
                + '<img src="' + this.roboHash(msg.username) + '">' // Avatar
                + msg.username
                + '</div>'
                + emojione.toImage(msg.data) + '<br/>'; // Parse emojis
            var element = document.getElementById('chat-messages');
            element.scrollTop = element.scrollHeight-100; // Auto scroll to the bottom
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
        roboHash: function(username) {
            return 'https://robohash.org/'+username+'.png?size=50x50'
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
