import {Decrypter, AESGCM128, Base64ToArrayBuffer} from "/js/message/crypto.js";

async function loadAndDecryptImage(imgId, decrypter) {
    const resp = await fetch('/api/v1/image/view', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: imgId })
    });

    if (!resp.ok) {
        throw new Error(`image/view failed: ${resp.status}`);
    }

    const encryptedBytes = await resp.arrayBuffer();
    const plainBytes = await decrypter.decryptToBytes(encryptedBytes);

    const blob = new Blob([plainBytes], { type: "image/*" });
    return URL.createObjectURL(blob);
}

async function loadMessage(msgId, key, iv, msgDiv) {
    $.get('/api/v1/message/view?id=' + msgId)
        .done(async function (viewResponse) {
            if (viewResponse.code !== 200) {
                msgDiv.html(viewResponse.body)
                return
            }

            let encryptedMsg = Base64ToArrayBuffer(viewResponse.body.text);

            try {
                let decrypter = new Decrypter(new AESGCM128());
                await decrypter.setup(Base64ToArrayBuffer(key), Base64ToArrayBuffer(iv));

                let decryptedMsg = await decrypter.decryptToString(encryptedMsg);
                msgDiv.text(decryptedMsg);
                msgDiv.html(msgDiv.text().replace(/(?:\r\n|\r|\n)/g, '<br>'));

                const imagesDiv = $('#images');
                imagesDiv.empty();

                const imgIds = (viewResponse.body.imgs || []);
                for (const imgId of imgIds) {
                    try {
                        const url = await loadAndDecryptImage(imgId, decrypter);

                        const img = document.createElement('img');

                        img.src = url;
                        img.loading = 'lazy';
                        img.style.maxWidth = '100%';
                        img.onload = () => URL.revokeObjectURL(url);

                        imagesDiv.append(img);
                    } catch (e) {
                        console.error(e);
                        imagesDiv.append(`<div>Could not load image ${imgId}</div>`);
                    }
                }
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
    var queryParams = new URLSearchParams(window.location.search);
    var anchorParams = new URLSearchParams(window.location.hash.slice(1)); // skip '#'

    let msgId = queryParams.get('id');
    let key = anchorParams.get('key');
    let iv = anchorParams.get('iv');
    let msgDiv = $('#message');

    if (!msgId || !key || !iv) {
        msgDiv.text('Missing id/key/iv in the link');
        return;
    }

    loadMessage(msgId, key, iv, msgDiv);
});
