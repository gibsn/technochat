$.getScript("/js/util.js");

function copyLink(id) {
    if (document.getElementById(id) == null) {
        return;
    }

    var copyFunc = copyToClipboardAny;
    if (navigator.userAgent.match(/ipad|ipod|iphone/i)) {
        copyFunc = copyToClipboardIOS;
    }

    if (copyFunc(id)) {
        $("#copy_button").html("Copied!");
    }
}
