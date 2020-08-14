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

// symbols counter
const maxLength = 4;

var textarea = document.querySelector('.js__textarea');
var counter = document.querySelector('.js__counter');
var counterMax = document.querySelector('.js__counter-max');

counterMax.innerHTML = maxLength;
textarea.setAttribute('maxlength', maxLength);

textarea.addEventListener('input', function () {
    var currentLength = textarea.value.length;
    if (currentLength > maxLength) { // если строго >, то красный цвет не добавляется, если >=, то красный добавляется, но последняя цифра не меняется
        counter.parentElement.style.color = 'red';
    } else {
        counter.innerHTML = currentLength;
        counter.parentElement.style.color = '#6d6d6d';
    }
});

console.log(counter.parentElement);

// $('#text').on('input', function () {
//     var maxL = $(this).attr('maxlength');
//     var currL = $(this).val().length;
//     if (currL > maxL) {
//         alert('Too many symbols');
//     } else {
//         $('#text-length').text(currL);
//     }
// });
