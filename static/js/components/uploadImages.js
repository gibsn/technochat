document.addEventListener('DOMContentLoaded', () => {
    const fileInput = document.querySelector('#file-input');
    const imagesPreview = document.querySelector('#preview');

    function createDeleteButton(img) {
        const deleteButton = document.createElement('span');
        deleteButton.classList.add('upload__delete');
        deleteButton.innerHTML = '&times;';

        deleteButton.addEventListener('click', function() {
            imagesPreview.removeChild(img.parentNode);
        });

        return deleteButton;
    }

    fileInput.addEventListener('change', function() {
        const files = this.files;

        if (files) {
            imagesPreview.innerHTML = '';

            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                const reader = new FileReader();

                reader.onload = function(e) {
                    const imgContainer = document.createElement('div');
                    imgContainer.classList.add('upload__img');

                    const img = document.createElement('img');
                    img.src = e.target.result;
                    imgContainer.appendChild(img);

                    const deleteButton = createDeleteButton(img);
                    imgContainer.appendChild(deleteButton);

                    imagesPreview.appendChild(imgContainer);
                };

                reader.readAsDataURL(file);
            }
        }
    });
});