import * as util from "/js/util.js";
import {AESGCM128, ArrayBufferToBase64, Encrypter} from "/js/message/crypto.js";

let copyButtonView;
let joinButtonView;
let createChatButtonView;
let chatEntryView;
let createChatFormView;
let joinLinkFormView;
let joinLinkInputView;
let joinLinkErrorView;

function isStandalonePWA() {
    return window.matchMedia('(display-mode: standalone)').matches ||
        window.navigator.standalone === true;
}

function configureJoinButton(link) {
    joinButtonView.href = link;

    if (isStandalonePWA()) {
        joinButtonView.removeAttribute('target');
        joinButtonView.removeAttribute('rel');
        return;
    }

    joinButtonView.target = '_blank';
    joinButtonView.rel = 'noopener';
}

function onJoinClick(e) {
    const joinLink = joinButtonView.getAttribute('href');
    if (!joinLink || joinLink === '#') {
        e.preventDefault();
        return;
    }

    if (isStandalonePWA() && window.TechnochatNetworkLoader) {
        window.TechnochatNetworkLoader.start();
    }
}

function chatLinkPath(rawLink) {
    let url;

    try {
        url = new URL(rawLink.trim(), window.location.origin);
    } catch (e) {
        return '';
    }

    const hashParams = new URLSearchParams(url.hash.replace(/^#/, ''));
    if (url.pathname !== '/html/joinchat.html' ||
        !url.searchParams.get('id') ||
        !hashParams.get('key')) {
        return '';
    }

    return url.pathname + url.search + url.hash;
}

function onShowCreateChat() {
    chatEntryView.style.display = 'none';
    createChatFormView.style.display = 'flex';
}

function onJoinLinkSubmit(e) {
    e.preventDefault();

    const path = chatLinkPath(joinLinkInputView.value);
    if (!path) {
        joinLinkErrorView.textContent = 'Paste a valid chat link';
        return;
    }

    joinLinkErrorView.textContent = '';
    if (isStandalonePWA() && window.TechnochatNetworkLoader) {
        window.TechnochatNetworkLoader.start();
    }
    window.location.href = path;
}

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
        configureJoinButton(link);
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

    chatEntryView = document.getElementById("chat_entry");
    createChatFormView = document.getElementById("text_form");
    createChatFormView.style.display = "none";

    createChatButtonView = document.getElementById("show_create_chat");
    createChatButtonView.addEventListener('click', onShowCreateChat);

    joinLinkFormView = document.getElementById("join_link_form");
    joinLinkFormView.addEventListener('submit', onJoinLinkSubmit);

    joinLinkErrorView = document.getElementById("join_link_error");
    joinLinkInputView = document.getElementById("join_link");
    joinLinkInputView.addEventListener('input', function () {
        joinLinkErrorView.textContent = '';
    });

    copyButtonView = document.getElementById("copy_button");
    copyButtonView.style.display = "none";

    joinButtonView = document.getElementById("join_button");
    joinButtonView.style.display = "none";
    joinButtonView.addEventListener('click', onJoinClick);

    $("form").submit(onSubmit);
}

document.addEventListener('DOMContentLoaded', () => {
    initPage();
});
