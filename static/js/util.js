export function copyButton(button, input) {
    const copyButton = document.getElementById(button);

    if (copyButton) {
        copyButton.addEventListener('click', async () => {
            const targetInput = document.getElementById(input);

            if (targetInput) {
                const inputValue = targetInput.value;

                try {
                    await navigator.clipboard.writeText(inputValue);
                    copyButton.textContent = 'Copied!';
                } catch (err) {
                    console.warn(err);
                }
            }
        });
    }
}

export function scrollToCopyButton() {
    $('html, body').animate({
        scrollTop: $('#copy_button').offset().top
    }, 1000);
}
