import {Decrypter, AESGCM128, Base64ToArrayBuffer} from "/js/message/crypto.js";

async function loadMessage(msgId, key, iv, msgDiv) {
    $.get('/api/v1/message/view?id=' + msgId)
        .done(async function (viewResponse) {
            if (viewResponse.code != 200) {
                msgDiv.html(viewResponse.body)
                return
            }

            let encryptedMsg = Base64ToArrayBuffer(viewResponse.body.text);

            try {
                let decrypter = new Decrypter(new AESGCM128());
                await decrypter.setup(Base64ToArrayBuffer(key), Base64ToArrayBuffer(iv));

                let decryptedMsg = await decrypter.decryptToString(encryptedMsg);
                msgDiv.html(decryptedMsg.replace(/(?:\r\n|\r|\n)/g, '<br>'))
            } catch (error) {
                console.error(error);
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
