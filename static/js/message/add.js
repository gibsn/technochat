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
const uploadStatusId = 'upload_status'

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
let selectedImages = [];
let isPreparingImages = false;

function isMobileSafari() {
    const ua = navigator.userAgent;
    const isAppleMobile = /iPhone|iPad|iPod/.test(ua);
    const isWebKit = /WebKit/.test(ua);
    const isOtherBrowserShell = /CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);

    return isAppleMobile && isWebKit && !isOtherBrowserShell;
}

function setUploadStatus(message, isError = false) {
    const uploadStatus = document.getElementById(uploadStatusId);
    if (!uploadStatus) {
        return;
    }

    uploadStatus.textContent = message;
    uploadStatus.style.color = isError ? 'red' : '#6d6d6d';
}

function revokePreviewUrls() {
    for (const image of selectedImages) {
        if (image.previewUrl) {
            URL.revokeObjectURL(image.previewUrl);
        }
    }
}

function isHeicLike(file) {
    const fileType = (file.type || '').toLowerCase();
    const fileName = (file.name || '').toLowerCase();

    return fileType === 'image/heic' ||
        fileType === 'image/heif' ||
        fileName.endsWith('.heic') ||
        fileName.endsWith('.heif');
}

function replaceFileExtension(fileName, newExtension) {
    const dotIndex = fileName.lastIndexOf('.');
    if (dotIndex < 0) {
        return fileName + newExtension;
    }

    return fileName.substring(0, dotIndex) + newExtension;
}

function blobToImage(blob) {
    return new Promise((resolve, reject) => {
        const objectUrl = URL.createObjectURL(blob);
        const img = new Image();

        img.onload = () => {
            URL.revokeObjectURL(objectUrl);
            resolve(img);
        };

        img.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            reject(new Error('browser could not decode image blob'));
        };

        img.src = objectUrl;
    });
}

function canvasToJpegBlob(canvas, quality) {
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (!blob) {
                reject(new Error('could not convert canvas to JPEG'));
                return;
            }

            resolve(blob);
        }, 'image/jpeg', quality);
    });
}

async function convertImageBlobToJpegFile(blob, originalFile) {
    const img = await blobToImage(blob);
    const canvas = document.createElement('canvas');

    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;

    const context = canvas.getContext('2d');
    if (!context) {
        throw new Error('could not get 2d canvas context');
    }

    context.drawImage(img, 0, 0);

    const jpegBlob = await canvasToJpegBlob(canvas, 0.92);
    return new File(
        [jpegBlob],
        replaceFileExtension(originalFile.name, '.jpg'),
        { type: 'image/jpeg', lastModified: originalFile.lastModified }
    );
}

async function convertHeicUsingBrowser(file) {
    return await convertImageBlobToJpegFile(file, file);
}

async function convertHeicToJpeg(file) {
    try {
        return await convertHeicUsingBrowser(file);
    } catch (browserError) {
        console.warn('native HEIC/HEIF conversion failed, falling back to heic2any', browserError);
    }

    const convertedBlob = await window.heic2any({
        blob: file,
        toType: 'image/jpeg',
        quality: 0.92,
    });

    const normalizedBlob = Array.isArray(convertedBlob) ? convertedBlob[0] : convertedBlob;
    return await convertImageBlobToJpegFile(normalizedBlob, file);
}

async function prepareImage(file) {
    let preparedFile = file;
    let wasConverted = false;

    if (isHeicLike(file)) {
        preparedFile = await convertHeicToJpeg(file);
        wasConverted = true;
    }

    return {
        originalFile: file,
        preparedFile: preparedFile,
        previewUrl: URL.createObjectURL(preparedFile),
        wasConverted: wasConverted,
    };
}

function createDeleteButton(imgIndex) {
    const deleteButton = document.createElement('span');
    deleteButton.classList.add('upload__delete');
    deleteButton.innerHTML = '&times;';

    deleteButton.addEventListener('click', function() {
        const removedImages = selectedImages.splice(imgIndex, 1);
        if (removedImages.length > 0 && removedImages[0].previewUrl) {
            URL.revokeObjectURL(removedImages[0].previewUrl);
        }

        renderImagesPreview();
    });

    return deleteButton;
}

function renderImagesPreview() {
    imagesPreview.innerHTML = '';

    for (let i = 0; i < selectedImages.length; i++) {
        const image = selectedImages[i];
        const imgContainer = document.createElement('div');
        imgContainer.classList.add('upload__img');

        const img = document.createElement('img');
        img.src = image.previewUrl;
        imgContainer.appendChild(img);

        const deleteButton = createDeleteButton(i);
        imgContainer.appendChild(deleteButton);

        if (image.wasConverted) {
            const convertedNote = document.createElement('div');
            convertedNote.textContent = 'Converted to JPEG';
            convertedNote.style.fontSize = '12px';
            convertedNote.style.marginTop = '4px';
            imgContainer.appendChild(convertedNote);
        }

        imagesPreview.appendChild(imgContainer);
    }
}

async function previewImages() {
    const files = Array.from(this.files || []);

    isPreparingImages = true;
    setUploadStatus('Preparing images...');

    revokePreviewUrls();
    selectedImages = [];
    renderImagesPreview();

    let convertedCount = 0;
    let failedCount = 0;

    for (const file of files) {
        try {
            const preparedImage = await prepareImage(file);
            if (preparedImage.wasConverted) {
                convertedCount++;
            }

            selectedImages.push(preparedImage);
        } catch (error) {
            failedCount++;
            console.error('could not prepare image', file.name, error);
        }
    }

    renderImagesPreview();
    isPreparingImages = false;

    if (failedCount > 0) {
        setUploadStatus(`Could not prepare ${failedCount} image(s) in the browser.`, true);
        return;
    }

    if (convertedCount > 0) {
        setUploadStatus(`Converted ${convertedCount} HEIC/HEIF image(s) to JPEG for compatibility.`);
        return;
    }

    setUploadStatus('');
}

async function uploadImages(images, ttl, encrypter) {
    let ids = [];

    for (let i = 0; i < images.length; i++) {
        let imageBytes = await images[i].preparedFile.arrayBuffer();

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

    if (isPreparingImages) {
        $('#loading').hide();
        setUploadStatus('Please wait until image preparation is complete.', true);
        return;
    }

    let encrypter = new Encrypter(new AESGCM128());
    await encrypter.setup();

    const ttl = getCurrentTTL();

    const text = $('#text').val();
    const encryptedText = await encrypter.encryptString(text);

    const imgsIds = await uploadImages(selectedImages, ttl, encrypter);

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
    setUploadStatus('');
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

    const fileInput = document.getElementById(fileInputId);
    if (isMobileSafari() && fileInput) {
        fileInput.setAttribute('accept', 'image/jpeg,image/png');
    }

    fileInput?.addEventListener("change", previewImages);
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
