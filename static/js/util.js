export function copyButton(button, input) {
    const copyButton = document.getElementById(button);

    if (!copyButton) {
        console.error('Copy button was not found');
        return;
    }

    copyButton.addEventListener('click', async () => {
        const targetInput = document.getElementById(input);

        if (!targetInput) {
            console.error('Copy block was not found');
            return;
        }

        const inputValue = targetInput.value;

        if (!inputValue.trim()) {
            console.error('Copy link was not found');
            return;
        }

        try {
            await navigator.clipboard.writeText(inputValue);
            copyButton.textContent = 'Copied!';
        } catch (err) {
            console.error('Failed to copy:', err);
        }
    });
}

export function resetCopyButton(button, text = 'Copy link') {
    const copyButton = document.getElementById(button);

    if (!copyButton) {
        return;
    }

    copyButton.textContent = text;
}

export function scrollToCopyButton() {
    $('html, body').animate({
        scrollTop: $('#copy_button').offset().top
    }, 1000);
}
