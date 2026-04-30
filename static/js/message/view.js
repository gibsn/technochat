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

async function fetchMessageView(msgId) {
    const resp = await fetch(`/api/v1/message/view?id=${encodeURIComponent(msgId)}`);

    if (!resp.ok) {
        throw new Error(`message/view failed: ${resp.status}`);
    }

    return await resp.json();
}

function setMessageLoading(messageElement) {
    messageElement.setAttribute('aria-busy', 'true');
    messageElement.innerHTML = '<span class="result__loader" aria-hidden="true"></span>Loading message...';
}

function clearMessageLoading(messageElement) {
    messageElement.removeAttribute('aria-busy');
}

function setMessageHtml(messageElement, text) {
    messageElement.innerHTML = text;
}

function setMessageText(messageElement, text) {
    messageElement.textContent = text;
}

function setMessageWithLineBreaks(messageElement, text) {
    messageElement.textContent = text;
    messageElement.innerHTML = messageElement.innerHTML.replace(/(?:\r\n|\r|\n)/g, '<br>');
}

function createImageLoader() {
    const loader = document.createElement('div');
    loader.classList.add('result__image-loader');

    const spinner = document.createElement('span');
    spinner.classList.add('upload__spinner');
    loader.appendChild(spinner);

    return loader;
}

function renderImageLoaders(imagesElement, count) {
    imagesElement.innerHTML = '';

    for (let i = 0; i < count; i++) {
        imagesElement.appendChild(createImageLoader());
    }
}

async function loadMessage(msgId, key, iv, messageElement, modal) {
    setMessageLoading(messageElement);

    try {
        const viewResponse = await fetchMessageView(msgId);

        if (viewResponse.code !== 200) {
            clearMessageLoading(messageElement);
            setMessageHtml(messageElement, viewResponse.body);
            return;
        }

        const encryptedMsg = Base64ToArrayBuffer(viewResponse.body.text);

        try {
            const decrypter = new Decrypter(new AESGCM128());
            await decrypter.setup(Base64ToArrayBuffer(key), Base64ToArrayBuffer(iv));

            const decryptedMsg = await decrypter.decryptToString(encryptedMsg);
            clearMessageLoading(messageElement);
            setMessageWithLineBreaks(messageElement, decryptedMsg);

            const imagesElement = document.getElementById('images');
            const imgIds = viewResponse.body.imgs || [];
            renderImageLoaders(imagesElement, imgIds.length);

            for (let i = 0; i < imgIds.length; i++) {
                const imgId = imgIds[i];
                const imageSlot = imagesElement.children[i];

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
            clearMessageLoading(messageElement);
            setMessageHtml(messageElement, 'Could not decrypt message, the link was possibly corrupted');
        }
    } catch (error) {
        console.error(error);
        clearMessageLoading(messageElement);
        setMessageHtml(messageElement, 'Internal Server Error');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const modal = setupImageModal();

    const queryParams = new URLSearchParams(window.location.search);
    const anchorParams = new URLSearchParams(window.location.hash.slice(1)); // skip '#'

    const msgId = queryParams.get('id');
    const key = anchorParams.get('key');
    const iv = anchorParams.get('iv');
    const messageElement = document.getElementById('message');

    if (!msgId || !key || !iv) {
        setMessageText(messageElement, 'Missing id/key/iv in the link');
        return;
    }

    loadMessage(msgId, key, iv, messageElement, modal).then();
});

window.addEventListener('beforeunload', () => {
    document.querySelectorAll('#images img').forEach(img => {
        if (img.src.startsWith('blob:')) {
            URL.revokeObjectURL(img.src);
        }
    });
});
