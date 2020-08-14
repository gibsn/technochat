document.addEventListener('DOMContentLoaded', () => {

    // symbols counter
    const maxLength = 10; // maximum number of symbols allowed

    var textarea = document.querySelector('.js__textarea');
    var counter = document.querySelector('.js__counter');
    var counterMax = document.querySelector('.js__counter-max');

    counterMax.innerHTML = maxLength;
    textarea.setAttribute('maxlength', maxLength);

    textarea.addEventListener('input', function () {
        var currentLength = textarea.value.length;
        counter.innerHTML = currentLength;

        if (currentLength >= maxLength) {
            counter.parentElement.style.color = 'red';
        } else {
            counter.parentElement.style.color = '#6d6d6d';
        }
    });
});