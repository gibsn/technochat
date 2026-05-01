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
const loadingId = 'loading'
const loadingLabelId = 'loading_label'
const loadingBarId = 'loading_bar'

const imageUploadAPI = '/api/v1/image/add'
const preferredImageMimeType = 'image/webp'
const fallbackImageMimeType = 'image/jpeg'
const maxPreparedImageBytes = 1.5 * 1024 * 1024
const maxImageDimension = 1200
const resizeScaleStep = 0.85
const imageQualitySteps = [0.9, 0.82, 0.75, 0.68, 0.6]

const imagesPreview = document.querySelector('#preview');
let selectedImages = [];
let isPreparingImages = false;

function clampProgress(progress) {
    return Math.max(0, Math.min(100, Math.round(progress)));
}

function setLoadingVisible(isVisible) {
    const loading = document.getElementById(loadingId);
    if (!loading) {
        return;
    }

    loading.style.display = isVisible ? 'flex' : 'none';
}

function setLoadingProgress(progress, label) {
    const normalizedProgress = clampProgress(progress);
    const loadingLabel = document.getElementById(loadingLabelId);
    const loadingBar = document.getElementById(loadingBarId);
    const loadingTrack = loadingBar?.parentElement;

    if (loadingLabel && label) {
        loadingLabel.textContent = label;
    }

    if (loadingBar) {
        loadingBar.style.width = `${normalizedProgress}%`;
    }

    if (loadingTrack) {
        loadingTrack.setAttribute('aria-valuenow', normalizedProgress.toString());
    }
}

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
    
    if (!isError) {
        uploadStatus.textContent = '';
        uploadStatus.style.color = '#6d6d6d';
        return;
    }

    uploadStatus.textContent = message;
    uploadStatus.style.color = 'red';
}

function renderImagesPlaceholder(count) {
    imagesPreview.innerHTML = '';

    for (let i = 0; i < count; i++) {
        const placeholder = document.createElement('div');
        placeholder.classList.add('upload__img-placeholder');

        const spinner = document.createElement('span');
        spinner.classList.add('upload__spinner');
        placeholder.appendChild(spinner);

        imagesPreview.appendChild(placeholder);
    }
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

function fileExtensionForMimeType(mimeType) {
    if (mimeType === preferredImageMimeType) {
        return '.webp';
    }

    return '.jpg';
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

function canvasToBlob(canvas, mimeType, quality) {
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (!blob) {
                reject(new Error(`could not convert canvas to ${mimeType}`));
                return;
            }

            resolve(blob);
        }, mimeType, quality);
    });
}

function drawImageToCanvas(img, width, height, mimeType) {
    const canvas = document.createElement('canvas');

    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d');
    if (!context) {
        throw new Error('could not get 2d canvas context');
    }

    if (mimeType === fallbackImageMimeType) {
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, width, height);
    }

    context.drawImage(img, 0, 0, width, height);
    return canvas;
}

function calculateTargetDimensions(width, height, scale = 1) {
    const largestDimension = Math.max(width, height);
    const dimensionScale = largestDimension > maxImageDimension
        ? maxImageDimension / largestDimension
        : 1;
    const totalScale = Math.min(1, dimensionScale * scale);

    return {
        width: Math.max(1, Math.round(width * totalScale)),
        height: Math.max(1, Math.round(height * totalScale)),
    };
}

async function encodeImageWithinLimit(imageSource, originalFile) {
    const originalWidth = imageSource.naturalWidth || imageSource.width;
    const originalHeight = imageSource.naturalHeight || imageSource.height;
    let scale = 1;
    let bestCandidate = null;

    while (true) {
        const dimensions = calculateTargetDimensions(originalWidth, originalHeight, scale);
        const mimeTypes = [preferredImageMimeType, fallbackImageMimeType];

        for (const mimeType of mimeTypes) {
            const canvas = drawImageToCanvas(imageSource, dimensions.width, dimensions.height, mimeType);

            for (const quality of imageQualitySteps) {
                const encodedBlob = await canvasToBlob(canvas, mimeType, quality);

                if (mimeType === preferredImageMimeType && encodedBlob.type !== preferredImageMimeType) {
                    break;
                }

                if (!bestCandidate || encodedBlob.size < bestCandidate.blob.size) {
                    bestCandidate = {
                        blob: encodedBlob,
                        mimeType: encodedBlob.type || mimeType,
                        width: dimensions.width,
                        height: dimensions.height,
                    };
                }

                if (encodedBlob.size <= maxPreparedImageBytes) {
                    const outputMimeType = encodedBlob.type || mimeType;
                    return {
                        preparedFile: new File(
                            [encodedBlob],
                            replaceFileExtension(originalFile.name, fileExtensionForMimeType(outputMimeType)),
                            { type: outputMimeType, lastModified: originalFile.lastModified }
                        ),
                        outputMimeType: outputMimeType,
                        width: dimensions.width,
                        height: dimensions.height,
                        wasResized: dimensions.width !== originalWidth || dimensions.height !== originalHeight,
                    };
                }
            }
        }

        if (dimensions.width <= 1 || dimensions.height <= 1) {
            break;
        }

        scale *= resizeScaleStep;
    }

    if (!bestCandidate) {
        throw new Error('could not encode image for upload');
    }

    const outputMimeType = bestCandidate.mimeType;
    return {
        preparedFile: new File(
            [bestCandidate.blob],
            replaceFileExtension(originalFile.name, fileExtensionForMimeType(outputMimeType)),
            { type: outputMimeType, lastModified: originalFile.lastModified }
        ),
        outputMimeType: outputMimeType,
        width: bestCandidate.width,
        height: bestCandidate.height,
        wasResized: bestCandidate.width !== originalWidth || bestCandidate.height !== originalHeight,
    };
}

async function convertImageBlobToPreferredFile(blob, originalFile) {
    const img = await blobToImage(blob);
    return await encodeImageWithinLimit(img, originalFile);
}

async function convertHeicUsingImageBitmap(file) {
    if (typeof createImageBitmap !== 'function') {
        throw new Error('createImageBitmap is not supported');
    }

    const bitmap = await createImageBitmap(file);

    try {
        return await encodeImageWithinLimit(bitmap, file);
    } finally {
        if (typeof bitmap.close === 'function') {
            bitmap.close();
        }
    }
}

async function convertHeicUsingBrowser(file) {
    try {
        return await convertHeicUsingImageBitmap(file);
    } catch (bitmapError) {
        console.warn('createImageBitmap HEIC/HEIF conversion failed, falling back to Image()', bitmapError);
    }

    return await convertImageBlobToPreferredFile(file, file);
}

async function convertHeicToPreferredFormat(file) {
    try {
        return await convertHeicUsingBrowser(file);
    } catch (browserError) {
        console.warn('native HEIC/HEIF conversion failed, falling back to heic2any', browserError);
    }

    const convertedBlob = await window.heic2any({
        blob: file,
        toType: fallbackImageMimeType,
        quality: 0.92,
    });

    const normalizedBlob = Array.isArray(convertedBlob) ? convertedBlob[0] : convertedBlob;
    return await convertImageBlobToPreferredFile(normalizedBlob, file);
}

async function prepareImage(file) {
    let preparedImage = null;
    let wasConverted = false;

    if (isHeicLike(file)) {
        preparedImage = await convertHeicToPreferredFormat(file);
        wasConverted = true;
    } else {
        preparedImage = await convertImageBlobToPreferredFile(file, file);
    }

    const preparedFile = preparedImage.preparedFile;
    const wasResized = preparedImage.wasResized;
    return {
        originalFile: file,
        preparedFile: preparedFile,
        previewUrl: URL.createObjectURL(preparedFile),
        wasConverted: wasConverted,
        wasResized: wasResized,
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

        const fileInput = document.getElementById(fileInputId);
        if (fileInput) {
            fileInput.value = '';
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

        imagesPreview.appendChild(imgContainer);
    }
}

async function previewImages() {
    const files = Array.from(this.files || []);

    isPreparingImages = true;
    setUploadStatus('Preparing images...');

    revokePreviewUrls();
    selectedImages = [];
    renderImagesPlaceholder(files.length);

    let failedCount = 0;
    const failedNames = [];

    for (const file of files) {
        try {
            const preparedImage = await prepareImage(file);
            selectedImages.push(preparedImage);
        } catch (error) {
            failedCount++;
            failedNames.push(file.name);
            console.error('could not prepare image', file.name, error);
        }
    }

    renderImagesPreview();
    isPreparingImages = false;

    if (failedCount > 0) {
        const filesLabel = failedNames.length > 0 ? ` (${failedNames.join(', ')})` : '';
        setUploadStatus(`Could not prepare ${failedCount} image(s) in the browser${filesLabel}.`, true);
        return;
    }

    setUploadStatus('');
}

async function uploadImages(images, ttl, encrypter) {
    let ids = [];
    const uploadProgressStart = 22;
    const uploadProgressEnd = 78;

    for (let i = 0; i < images.length; i++) {
        const currentImageNumber = i + 1;
        const progressStep = (uploadProgressEnd - uploadProgressStart) / images.length;
        const progress = uploadProgressStart + (progressStep * i);

        setLoadingProgress(progress, `Uploading image ${currentImageNumber} of ${images.length}...`);
        setUploadStatus(`Uploading image ${currentImageNumber} of ${images.length}...`);

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
        setLoadingProgress(uploadProgressStart + (progressStep * currentImageNumber), `Uploaded image ${currentImageNumber} of ${images.length}`);
    }

    if (images.length > 0) {
        setUploadStatus('');
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
    setLoadingVisible(true);
    setLoadingProgress(6, 'Preparing secure link...');
    util.resetCopyButton('copy_button');
    e.preventDefault();

    if (isPreparingImages) {
        setLoadingVisible(false);
        setUploadStatus('Please wait until image preparation is complete.', true);
        return;
    }

    setLoadingProgress(14, 'Encrypting message...');
    let encrypter = new Encrypter(new AESGCM128());
    await encrypter.setup();

    const ttl = getCurrentTTL();

    const text = $('#text').val();
    const encryptedText = await encrypter.encryptString(text);

    if (selectedImages.length > 0) {
        setLoadingProgress(22, `Uploading image 1 of ${selectedImages.length}...`);
    } else {
        setLoadingProgress(78, 'Packaging link...');
    }

    const imgsIds = await uploadImages(selectedImages, ttl, encrypter);

    const formData = new FormData();
    formData.append("text", ArrayBufferToBase64(encryptedText));
    formData.append("ttl", ttl);

    formData.append("imgs", imgsIds.join(","));

    setLoadingProgress(88, 'Creating one-time link...');

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

    setUploadStatus('');

    if (addResponse.code === 200) {
        setLoadingProgress(100, 'Link is ready');
        let link = addResponse.body.link;
        link += '#key=' + encodeURIComponent(this.key);
        link += '&iv=' + encodeURIComponent(this.iv);

        $('#text').val('');
        $('#result_link').html('<input id="to_copy" value="' + link + '">' + link + '</input>');
    } else {
        setLoadingProgress(100, 'Could not create link');
        $('#result_link').html("error: " + addResponse.body);
    }

    setTimeout(() => {
        setLoadingVisible(false);
    }, 250);

    util.scrollToCopyButton();
}

function onMessageSubmitError(e) {
    setLoadingVisible(false);
    $('#result_text').html('Internal Server Error');

    util.scrollToCopyButton();
}

function initPage() {
    setLoadingVisible(false);
    setLoadingProgress(0, 'Generating link...');
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
