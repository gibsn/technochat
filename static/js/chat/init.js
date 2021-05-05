function onSubmit(e) {
    $("#loading").show();
    e.preventDefault();

    var fd = new FormData($("form")[0]);
    var obj = {};
    fd.forEach(function (value, key) {
        obj[key] = value;
    });
    console.log(fd)

    $.ajax({
        type: 'POST',
        url: $(this).attr("action"),
        data: JSON.stringify(obj),
        contentType: "application/json",
        processData: false,
        success: onSubmitSuccess,
        error: onSubmitError,
    });
}

function onSubmitSuccess(json) {
    if (json.code == 200) {
        var id = json.body.id;
        var link = 'https://' + window.location.host + '/html/joinchat.html?id=' + id
        $("#result_link").html('<a href="' + link + '">' + link + '</a>');
    } else {
        $("#result_link").html("error: " + json.body);
    }
}

function onSubmitError(e) {
    $("#loading").hide();
    $("#result_text").html("Internal Server Error");
}

function initPage() {
    $("#loading").html('');
    $("#result_text").html('');
    $("#result_link").html('');

    $("form").submit(onSubmit);
}

document.addEventListener('DOMContentLoaded', () => {
    initPage();
});
