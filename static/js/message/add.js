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

function scrollToCopyButton() {
    $('html, body').animate({
        scrollTop: $('#copy_button').offset().top
    }, 1000);
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
