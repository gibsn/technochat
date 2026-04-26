import {Decrypter, AESGCM128, Base64ToArrayBuffer} from "/js/message/crypto.js";

function setupImageModal() {
    const modal = document.getElementById('img_modal');
    const modalImg = document.getElementById('img_modal_img');
    const closeBtn = document.getElementById('img_modal_close');
    const backdrop = document.getElementById('img_modal_backdrop');

    function open(url) {
        modalImg.src = url;
        modal.classList.add('is-open');
        modal.setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden';
    }

    function close() {
        modal.classList.remove('is-open');
        modal.setAttribute('aria-hidden', 'true');
        document.body.style.overflow = '';
        modalImg.src = '';
    }

    closeBtn.addEventListener('click', close);
    backdrop.addEventListener('click', close);

    return { open, close };
}

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

function setMessageLoading(msgDiv) {
    msgDiv
        .attr('aria-busy', 'true')
        .html('<span class="result__loader" aria-hidden="true"></span>Loading message...');
}

function clearMessageLoading(msgDiv) {
    msgDiv.removeAttr('aria-busy');
}

function createImageLoader() {
    const loader = document.createElement('div');
    loader.classList.add('result__image-loader');

    const spinner = document.createElement('span');
    spinner.classList.add('upload__spinner');
    loader.appendChild(spinner);

    return loader;
}

function renderImageLoaders(imagesDiv, count) {
    imagesDiv.empty();

    for (let i = 0; i < count; i++) {
        imagesDiv.append(createImageLoader());
    }
}

async function loadMessage(msgId, key, iv, msgDiv, modal) {
    setMessageLoading(msgDiv);

    $.get('/api/v1/message/view?id=' + msgId)
        .done(async function (viewResponse) {
            if (viewResponse.code !== 200) {
                clearMessageLoading(msgDiv);
                msgDiv.html(viewResponse.body)
                return
            }

            let encryptedMsg = Base64ToArrayBuffer(viewResponse.body.text);

            try {
                let decrypter = new Decrypter(new AESGCM128());
                await decrypter.setup(Base64ToArrayBuffer(key), Base64ToArrayBuffer(iv));

                let decryptedMsg = await decrypter.decryptToString(encryptedMsg);
                clearMessageLoading(msgDiv);
                msgDiv.text(decryptedMsg);
                msgDiv.html(msgDiv.text().replace(/(?:\r\n|\r|\n)/g, '<br>'));

                const imagesDiv = $('#images');
                const imgIds = (viewResponse.body.imgs || []);
                renderImageLoaders(imagesDiv, imgIds.length);

                for (let i = 0; i < imgIds.length; i++) {
                    const imgId = imgIds[i];
                    const imageSlot = imagesDiv.children().get(i);

                    try {
                        const url = await loadAndDecryptImage(imgId, decrypter);

                        const img = document.createElement('img');

                        img.src = url;
                        img.loading = 'lazy';

                        img.addEventListener('click', () => {
                            modal.open(url);
                        });

                        imageSlot.replaceWith(img);
                    } catch (e) {
                        console.error(e);
                        const errorMessage = document.createElement('div');
                        errorMessage.classList.add('result__image-error');
                        errorMessage.textContent = `Could not load image ${imgId}`;
                        imageSlot.replaceWith(errorMessage);
                    }
                }
            } catch (error) {
                console.error(error);
                clearMessageLoading(msgDiv);
                msgDiv.html('Could not decrypt message, the link was possibly corrupted');
            }
        })
        .fail(function (viewResponse) {
            clearMessageLoading(msgDiv);
            msgDiv.html('Internal Server Error')
        });
}

document.addEventListener('DOMContentLoaded', () => {
    const modal = setupImageModal();

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

    loadMessage(msgId, key, iv, msgDiv, modal).then();
});

window.addEventListener('beforeunload', () => {
    document.querySelectorAll('#images img').forEach(img => {
        if (img.src.startsWith('blob:')) {
            URL.revokeObjectURL(img.src);
        }
    });
});
