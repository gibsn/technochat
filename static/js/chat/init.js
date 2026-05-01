import * as util from "/js/util.js";
import {AESGCM128, ArrayBufferToBase64, Encrypter} from "/js/message/crypto.js";

let copyButtonView;
let joinButtonView;

function onSubmit(e) {
    $("#loading").show();
    util.resetCopyButton('copy_button');
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

async function onSubmitSuccess(json) {
    $("#loading").hide();

    $("#link_box").show();

    copyButtonView.style.display = "inline-flex";
    joinButtonView.style.display = "none";

    if (json.code == 200) {
        var id = json.body.id;
        var key;

        try {
            var encrypter = new Encrypter(new AESGCM128());
            await encrypter.setup();
            key = ArrayBufferToBase64(encrypter.exportKey);
        } catch (e) {
            console.error('could not generate chat key', e);
            $("#result_link").html("error: could not generate chat encryption key");
            copyButtonView.style.display = "none";
            return;
        }

        var link = window.location.origin + '/html/joinchat.html?id=' + id + '#key=' + encodeURIComponent(key);
        $('#result_link').html('<input id="to_copy" value="' + link + '">' + link + '</input>');
        joinButtonView.href = link;
        joinButtonView.style.display = "inline-flex";
    } else {
        $("#result_link").html("error: " + json.body);
    }

    util.scrollToCopyButton();
}

function onSubmitError() {
    $("#loading").hide();
    $("#result_link").html("Internal Server Error");

    $("#link_box").show();

    copyButtonView.style.display = "inline-flex";
    joinButtonView.style.display = "none";

    util.scrollToCopyButton();
}

function initPage() {
    $("#loading").html('');
    $("#result_link").html('');

    $("#link_box").hide();

    util.copyButton('copy_button', 'to_copy');

    copyButtonView = document.getElementById("copy_button");
    copyButtonView.style.display = "none";

    joinButtonView = document.getElementById("join_button");
    joinButtonView.style.display = "none";

    $("form").submit(onSubmit);
}

document.addEventListener('DOMContentLoaded', () => {
    initPage();
});
