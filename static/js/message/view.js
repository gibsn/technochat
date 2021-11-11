import * as myCrypto from "/js/message/crypto.js";

async function loadMessage(msgId, key, iv, msgDiv) {
    $.get('/api/v1/message/view?id=' + msgId)
        .done(async function (viewResponse) {
            if (viewResponse.code != 200) {
                msgDiv.html(viewResponse.body)
                return
            }

            let encryptedMsg = viewResponse.body.text;

            try {
                let decryptedMsg = await myCrypto.decrypt(encryptedMsg, key, iv);
                msgDiv.html(decryptedMsg.replace(/(?:\r\n|\r|\n)/g, '<br>'))
            } catch {
                msgDiv.html('Could not decrypt message, the link was possibly corrupted');
            }
        })
        .fail(function (viewResponse) {
            msgDiv.html('Internal Server Error')
        });
}

document.addEventListener('DOMContentLoaded', () => {
    var queryParams  = new URLSearchParams(window.location.search);
    var anchorParams = new URLSearchParams(window.location.hash.slice(1)); // skip '#'

    let msgId  = queryParams.get('id');
    let key    = anchorParams.get('key');
    let iv     = anchorParams.get('iv');
    let msgDiv = $('#message');

    loadMessage(msgId, key, iv, msgDiv);
});
