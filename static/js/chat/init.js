import * as util from "/js/util.js";

function onSubmit(e) {
    $("#loading").show();
    e.preventDefault();

    var fd = new FormData($("form")[0]);
    var obj = {};
    fd.forEach(function (value, key) {
        obj[key] = value;
    });

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
    $("#loading").hide();

    $("#link_box").show();

    const copyButtonView = document.getElementById("copy_button");

    copyButtonView.style.display = "inline-flex";

    if (json.code == 200) {
        var id = json.body.id;
        var link = 'https://' + window.location.host + '/html/joinchat.html?id=' + id
        $('#result_link').html('<input id="to_copy" value="' + link + '">' + link + '</input>');
    } else {
        $("#result_link").html("error: " + json.body);
    }

    util.scrollToCopyButton();
}

function onSubmitError(e) {
    $("#loading").hide();
    $("#result_link").html("Internal Server Error");

    $("#link_box").show();

    const copyButtonView = document.getElementById("copy_button");

    copyButtonView.style.display = "inline-flex";

    util.scrollToCopyButton();
}

function initPage() {
    $("#loading").html('');
    $("#result_link").html('');

    $("#link_box").hide();

    const copyButtonView = document.getElementById("copy_button");

    copyButtonView.style.display = "none";

    util.copyButton('copy_button', 'to_copy');

    $("form").submit(onSubmit);
}

document.addEventListener('DOMContentLoaded', () => {
    initPage();
});
