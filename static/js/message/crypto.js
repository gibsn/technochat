const alg = { name: 'AES-GCM', length: 128 };


function arrayBufferToBase64(buf) {
    return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

function base64ToArrayBuffer(sInBase64) {
    let sRaw = atob(sInBase64);
    let bufArr = new Uint8Array(sRaw.length);

    for (let i = 0; i < sRaw.length; i++) {
        bufArr[i] = sRaw.charCodeAt(i);
    }

    return bufArr.buffer;
}

// encrypt encrypts the given string 's' and returns the encrypted string,
// key and iv, all base64 encoded
export async function encrypt(s) {
    let key = await crypto.subtle.generateKey(alg, true, ['encrypt', 'decrypt']);

    let _alg = alg;
    _alg.iv = crypto.getRandomValues(new Uint8Array(12));

    let encrypted = await crypto.subtle.encrypt(_alg, key, new TextEncoder().encode(s));
    let encryptedBase64 = arrayBufferToBase64(encrypted);

    let keyExported = await crypto.subtle.exportKey("raw", key);
    let keyBase64 = arrayBufferToBase64(keyExported);

    let ivBase64 = arrayBufferToBase64(_alg.iv);

    return {
        "encrypted": encryptedBase64,
        "key": keyBase64,
        "iv": ivBase64,
    }
}

// decrypt takes an encrypted string, key and iv, all are base64 encoded strings,
// decrypts the given string and returns it as a string
export async function decrypt(sInBase64, keyInBase64, ivInBase64) {
    let sRaw   = base64ToArrayBuffer(sInBase64);
    let keyRaw = base64ToArrayBuffer(keyInBase64);
    let ivRaw  = base64ToArrayBuffer(ivInBase64);

    let _alg = alg;
    _alg.iv = ivRaw;

    let key = await crypto.subtle.importKey('raw', keyRaw, _alg, false, ['decrypt']);
    let decrypted = await crypto.subtle.decrypt(_alg, key, sRaw);

    return new TextDecoder('utf-8').decode(decrypted);
}
