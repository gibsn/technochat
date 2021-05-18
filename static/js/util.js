function copyToClipboardIOS(id) {
    var el = document.getElementById(id);

    var oldContentEditable = el.contentEditable,
        oldReadOnly = el.readOnly,
        range = document.createRange();

    el.contenteditable = true;
    el.readonly = false;
    range.selectNodeContents(el);

    var s = window.getSelection();
    s.removeAllRanges();
    s.addRange(range);

    el.setSelectionRange(0, el.value.length);

    el.contentEditable = oldContentEditable;
    el.readOnly = oldReadOnly;

    try {
        var isCopied = document.execCommand('copy');
    } catch(err) {
        console.error("could not copy id %s to clipboard: ", id, err);
        var isCopied = false;
    }

    return isCopied
}

function copyToClipboardAny(id) {
    var el = document.getElementById(id);

    try {
        el.focus();
        el.select();
        var isCopied = document.execCommand('copy');
    } catch(err) {
        console.error("could not copy id %s to clipboard: ", id, err);
        var isCopied = false;
    }

    return isCopied
}