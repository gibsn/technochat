const maxTextAreaLength = 1024;
const initialTextAreaLength = 0;


function onMessageSubmit(e) {
    $('#loading').show();
    $('#copy_button').html('Copy link');
    e.preventDefault();

    $.ajax({
        type: 'POST',
        url: $(this).attr('action'),
        data: new FormData($('#text_form')[0]),
        contentType: false,
        processData: false,
        success: onMessageSubmitSuccess,
        error: onMessageSubmitError,
    });
}

function onMessageSubmitSuccess(addResponse) {
    var userText = $('#text').val();
    $('#result_text').html(userText.replace(/(?:\r\n|\r|\n)/g, '<br>'));

    $('#text').val('');
    $('#loading').hide();

    if (addResponse.code == 200) {
        var link = addResponse.body.link;
        $('#result_link').html('<input id="to_copy" value="' + link + '">' + link + '</input>');
    } else {
        $('#result_link').html("error: " + addResponse.body);
    }

    scrollToCopyButton();
}

function onMessageSubmitError(e) {
    $('#loading').hide();
    $('#result_text').html('Internal Server Error');

    scrollToCopyButton();
}

function initPage() {
    $('#loading').hide();
    $('#result_text').html('');
    $('#result_link').html('');

    $('#text_form').submit(onMessageSubmit);

    $('.button__generate').on('click', function () {
        $('.message__box').css('display', 'block');
    });
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


$.getScript("/js/util.js");

document.addEventListener('DOMContentLoaded', () => {
    initPage()
    initSymbolsCounter()
});
