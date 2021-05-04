function loadMessage(messageID, messageBox) {
    $.get('/api/v1/message/view?id=' + messageID)
        .done(function (viewResponse) {
            if (viewResponse.code == 200) {
                messageBox.html(viewResponse.body.text.replace(/(?:\r\n|\r|\n)/g, '<br>'))
            } else {
                messageBox.html(viewResponse.body)
            }
        })
        .fail(function (viewResponse) {
            messageBox.html('Internal Server Error')
        });
}

document.addEventListener('DOMContentLoaded', () => {
    var queryParams = new URLSearchParams(window.location.search);
    loadMessage(queryParams.get('id'), $('#message'));
});
