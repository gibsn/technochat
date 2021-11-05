const alg = { name: 'AES-GCM', length: 256 };


function arrayBufferToBase64(buf) {
    return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

export async function encrypt(s) {
    let key = await crypto.subtle.generateKey(alg, true, ['encrypt', 'decrypt']);

    let _alg = alg;
    _alg.iv = crypto.getRandomValues(new Uint8Array(12));

    let encrypted = await crypto.subtle.encrypt(_alg, key, new TextEncoder().encode(s));
    let encryptedBase64 = arrayBufferToBase64(encrypted);

    let keyExported = await crypto.subtle.exportKey("raw", key);
    let keyBase64 = arrayBufferToBase64(keyExported);

    return {
        "encrypted": encryptedBase64,
        "key": keyBase64,
    }
}

function decrypt(s, key) {

}
