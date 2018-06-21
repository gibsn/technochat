function onMessageSubmit(e) {
    $("#loading").show();
    e.preventDefault();

    $.ajax({
        type: 'POST',
        url: $(this).attr("action"),
        data: new FormData($("form")[0]),
        contentType: false,
        processData: false,
        success: onMessageSubmitSuccess,
        error: onMessageSubmitError,
    });
}

function onMessageSubmitSuccess(addResponse) {
    var userText = $("#text").val();
    $("#result_text").html(userText);

    $("#text").val('');
    $("#loading").hide();

    if (addResponse.code == 200) {
        var link = addResponse.body.link;
        $("#result_link").html('<a href="'+link+'">'+link+'</a>');
    } else {
        $("#result_link").html(addResponse.body);
    }
}

function onMessageSubmitError(e) {
    $("#loading").hide();
    $("#result_text").html("Internal Server Error");
}