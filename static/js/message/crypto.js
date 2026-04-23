export function ArrayBufferToBase64(buf) {
    return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

export function Base64ToArrayBuffer(sInBase64) {
    let sRaw = atob(sInBase64);
    let bufArr = new Uint8Array(sRaw.length);

    for (let i = 0; i < sRaw.length; i++) {
        bufArr[i] = sRaw.charCodeAt(i);
    }

    return bufArr.buffer;
}

class EncryptionAlgorithm {
    get params() {
        throw new Error("params must be implemented");
    }
}

export class AESGCM128 extends EncryptionAlgorithm {
    get params() {
        return { name: 'AES-GCM', length: 128 };
    }
}

export class Encrypter {
    #_algParams;
    #_encryptionParams;

    #_key;
    #_exportKey;

    constructor(alg) {
        this._algParams = alg.params;
        this._encryptionParams = alg.params;
    }

    async setup() {
        this._key = await crypto.subtle.generateKey(this._algParams, true, ['encrypt', 'decrypt']);
        this._exportKey = await crypto.subtle.exportKey("raw", this._key);

        this._encryptionParams.iv = crypto.getRandomValues(new Uint8Array(12));
    }

    get exportKey() {
        return this._exportKey;
    }

    get iv() {
        return this._encryptionParams.iv;
    }

    // encryptString encrypts the given string and returns the encrypted ArrayBuffer
    async encryptString(s) {
        return this.encryptBytes(new TextEncoder().encode(s));
    }

    // encryptBytes encrypts the given ArrayBuffer and returns the encrypted ArrayBuffer
    async encryptBytes(buf) {
        return await crypto.subtle.encrypt(this._encryptionParams, this._key, buf);
    }
}

export class Decrypter {
    #_algParams;
    #_importedKey;
    #_decryptionParams;

    constructor(alg) {
        this._algParams = alg.params;
        this._decryptionParams = alg.params;
    }

    async setup(key, iv) {
        this._decryptionParams.iv = iv;
        this._importedKey = await crypto.subtle.importKey(
            'raw', key, this._decryptionParams, false, ['decrypt']
        );
    }

    // decrypt takes an encrypted ArrayBuffer, decrypts and returns it as an ArrayBuffer
    async decryptToBytes(buf) {
        return crypto.subtle.decrypt(this._decryptionParams, this._importedKey, buf);
    }

    // decrypt takes an encrypted ArrayBuffer, decrypts and returns it as an ArrayBuffer
    async decryptToString(buf) {
        console.log(buf);
        let decryptedBytes = await this.decryptToBytes(buf);

        return new TextDecoder('utf-8').decode(decryptedBytes);
    }
}
