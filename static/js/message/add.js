import * as myCrypto from "/js/message/crypto.js";
import * as util from "/js/util.js";

const maxTextAreaLength = 1024;
const initialTextAreaLength = 0;


async function onMessageSubmit(e) {
    $('#loading').show();
    $('#copy_button').html('Copy link');
    e.preventDefault();

    // we encrypt the message so that no one
    // with access to DB server could read it
    let textForm = document.getElementById('text_form');
    let encryptionRes = await myCrypto.encrypt(textForm[0].value);

    // since we do not want to change the original form
    // (hereby changing UI), we will edit a copy of the form
    let textFormCopy = textForm.cloneNode(true);
    textFormCopy[0].value = encryptionRes.encrypted;

    $.ajax({
        type: 'POST',
        url: $(this).attr('action'),
        data: new FormData(textFormCopy),
        contentType: false,
        processData: false,
        success: onMessageSubmitSuccess,
        error: onMessageSubmitError,
        key: encryptionRes.key,
        iv: encryptionRes.iv,
    });
}

function onMessageSubmitSuccess(addResponse) {
    var userText = $('#text').val();
    $('#result_text').html(userText.replace(/(?:\r\n|\r|\n)/g, '<br>'));

    $('#text').val('');
    $('#loading').hide();

    if (addResponse.code == 200) {
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

    $('#text_form').submit(onMessageSubmit);

    $('.button__generate').on('click', function () {
        $('.message__box').css('display', 'block');
    });

    $("#copy_button").click(function() { util.copyLink("to_copy") });
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
    var textform = document.querySelector('#text_form');
    textform.addEventListener('submit', function() {
        counter.innerHTML = initialTextAreaLength;
        counter.parentElement.style.color = '#6d6d6d';
    });
}


document.addEventListener('DOMContentLoaded', () => {
    initPage();
    initSymbolsCounter();
});
