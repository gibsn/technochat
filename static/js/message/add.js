import {Encrypter, AESGCM128, ArrayBufferToBase64} from "/js/message/crypto.js";
import * as util from "/js/util.js";

const maxTextAreaLength = 1024;
// say we have N bytes of text on client, AES-GCM will add 16 bytes,
// base64 encoding will increase size to ((4 * (N + 16) / 3) + 3) & ~3.
// must set such a limit on backend that a text of original
// size of N runes can be saved.

const initialTextAreaLength = 0;

const fileInputId = 'file-input'
const textInputId = 'text_form'

const imageUploadAPI = '/api/v1/image/add'

// const upload = new FileUploadWithPreview.FileUploadWithPreview('myFirstImage', {
//     multiple: true,
//     maxFileCount: 5,
//     text: {
//         browse: 'Choose',
//         chooseFile: 'Choose images to upload',
//         label: 'Max 5 images',
//     },
// });

const imagesPreview = document.querySelector('#preview');

function createDeleteButton(img) {
    const deleteButton = document.createElement('span');
    deleteButton.classList.add('upload__delete');
    deleteButton.innerHTML = '&times;';

    deleteButton.addEventListener('click', function() {
        imagesPreview.removeChild(img.parentNode);
    });

    return deleteButton;
}

function previewImages() {
    const files = this.files;

    if (files) {
        imagesPreview.innerHTML = '';

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const reader = new FileReader();

            reader.onload = function(e) {
                const imgContainer = document.createElement('div');
                imgContainer.classList.add('upload__img');

                const img = document.createElement('img');
                img.src = e.target.result;
                imgContainer.appendChild(img);

                const deleteButton = createDeleteButton(img);
                imgContainer.appendChild(deleteButton);

                imagesPreview.appendChild(imgContainer);
            };

            reader.readAsDataURL(file);
        }
    }
}

async function uploadImages(images, ttl, encrypter) {
    let ids = [];

    for (let i = 0; i < images.length; i++) {
        let imageBytes = await images[i].arrayBuffer();

        if (encrypter) {
            imageBytes = await encrypter.encryptBytes(imageBytes);
        }

        let formData = new FormData();
        formData.append("image", new Blob([imageBytes], { type: "application/octet-stream" }));
        formData.append("ttl", ttl);

        let resp;
        try {
            resp = await $.ajax({
                type: 'POST',
                url: imageUploadAPI,
                data: formData,
                contentType: false,
                processData: false
            });
        } catch (errorResp) {
            if (errorResp.status !== 200) {
                console.error("could not upload image: http status is", errorResp.status);
                continue;
            }
        }

        if (resp.code !== 200) {
            console.error("could not upload image: code is", resp.code, "body is", resp.body);
            continue;
        }

        ids.push(resp.body.id);
    }

    return ids;
}

function getCurrentTTL() {
    for (const checkmark of document.getElementsByName("ttl")) {
        if (checkmark.checked) {
            return checkmark.value;
        }
    }

    return 86400;
}

async function onMessageSubmit(e) {
    $('#loading').show();
    $('#copy_button').html('Copy link');
    e.preventDefault();

    let encrypter = new Encrypter(new AESGCM128());
    await encrypter.setup();

    const ttl = getCurrentTTL();

    const text = $('#text').val();
    const encryptedText = await encrypter.encryptString(text);

    const imgsIds = await uploadImages(document.getElementById(fileInputId).files, ttl, encrypter);

    const formData = new FormData();
    formData.append("text", ArrayBufferToBase64(encryptedText));
    formData.append("ttl", ttl);

    formData.append("imgs", imgsIds.join(","));

    $.ajax({
        type: 'POST',
        url: $('#text_form').attr('action'),
        data: formData,
        contentType: false,
        processData: false,
        success: onMessageSubmitSuccess,
        error: onMessageSubmitError,
        key: ArrayBufferToBase64(encrypter.exportKey),
        iv: ArrayBufferToBase64(encrypter.iv),
    });
}

function onMessageSubmitSuccess(addResponse) {
    var userText = $('#text').val();
    $('#result_text').html(userText.replace(/(?:\r\n|\r|\n)/g, '<br>'));

    $('#text').val('');
    $('#loading').hide();

    if (addResponse.code === 200) {
        let link = addResponse.body.link;
        link += '#key=' + encodeURIComponent(this.key);
        link += '&iv=' + encodeURIComponent(this.iv);

        $('#result_link').html('<input id="to_copy" value="' + link + '">' + link + '</input>');
    } else {
        $('#result_link').html("error: " + addResponse.body);
    }

    util.scrollToCopyButton();
}

function onMessageSubmitError(e) {
    $('#loading').hide();
    $('#result_text').html('Internal Server Error');

    util.scrollToCopyButton();
}

function initPage() {
    $('#loading').hide();
    $('#result_text').html('');
    $('#result_link').html('');

    document.getElementById(fileInputId)?.addEventListener("change", previewImages);
    document.getElementById(textInputId)?.addEventListener("submit", onMessageSubmit);

    const generateButton = document.getElementById('generate_button');
    const messageBox = document.getElementById('message_box');

    if (generateButton) {
        generateButton.addEventListener('click', () => {
            messageBox.style.display = "block";
        });
    }

    util.copyButton('copy_button', 'to_copy');
}

function initSymbolsCounter() {
    var textarea = document.querySelector('.js__textarea');
    var counter = document.querySelector('.js__counter');
    var counterMax = document.querySelector('.js__counter-max');

    // set defaults
    counter.innerHTML = initialTextAreaLength;
    counterMax.innerHTML = maxTextAreaLength;
    textarea.setAttribute('maxlength', maxTextAreaLength);

    // change colour to red in case symbols limit is reached
    textarea.addEventListener('input', function () {
        var currentLength = textarea.value.length;
        counter.innerHTML = currentLength;

        if (currentLength < maxTextAreaLength) {
            counter.parentElement.style.color = '#6d6d6d';
            return
        }

        counter.parentElement.style.color = 'red';

        // on some platforms (like iOS) maxlength is disregarded so we
        // have to do our own limitng with JS
        // see https://github.com/gibsn/technochat/pull/62#issuecomment-687644035
        textarea.value = textarea.value.substring(0, maxTextAreaLength);
        counter.innerHTML = maxTextAreaLength;
    });

    // clear counter after the message has been submitted
    var textform = document.getElementById(textInputId);
    textform.addEventListener('submit', function() {
        counter.innerHTML = initialTextAreaLength;
        counter.parentElement.style.color = '#6d6d6d';
    });
}


document.addEventListener('DOMContentLoaded', () => {
    initPage();
    initSymbolsCounter();
});
