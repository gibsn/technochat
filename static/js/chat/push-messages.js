const dbName = 'technochat-push-messages';
const dbVersion = 1;
const storeName = 'messages';

export async function readPushMessages(chatID) {
    const db = await openDB();
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const index = store.index('chatId');
    const messages = await requestToPromise(index.getAll(chatID));
    await transactionDone(tx);
    db.close();

    return sortAndDeduplicate(messages);
}

export async function deletePushMessages(chatID, messageIDs) {
    if (!messageIDs.length) {
        return;
    }

    const db = await openDB();
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    messageIDs.forEach(function(messageID) {
        store.delete(messageKey(chatID, messageID));
    });
    await transactionDone(tx);
    db.close();
}

function sortAndDeduplicate(messages) {
    const byID = new Map();

    (messages || []).forEach(function(message) {
        if (!message || !message.messageId) {
            return;
        }

        byID.set(message.messageId, message);
    });

    return Array.from(byID.values()).sort(comparePushMessages);
}

function comparePushMessages(left, right) {
    const leftSeq = Number(left.messageSeq) || 0;
    const rightSeq = Number(right.messageSeq) || 0;
    if (leftSeq && rightSeq && leftSeq !== rightSeq) {
        return leftSeq - rightSeq;
    }
    if (leftSeq && !rightSeq) {
        return -1;
    }
    if (!leftSeq && rightSeq) {
        return 1;
    }

    return timestamp(left) - timestamp(right);
}

function timestamp(message) {
    const parsed = Date.parse(message.timestamp || '');
    return Number.isFinite(parsed) ? parsed : 0;
}

function openDB() {
    return requestToPromise(indexedDB.open(dbName, dbVersion), function(db) {
        if (!db.objectStoreNames.contains(storeName)) {
            const store = db.createObjectStore(storeName, { keyPath: 'key' });
            store.createIndex('chatId', 'chatId', { unique: false });
        }
    });
}

function messageKey(chatID, messageID) {
    return chatID + ':' + messageID;
}

function requestToPromise(request, onUpgradeNeeded) {
    return new Promise(function(resolve, reject) {
        request.onupgradeneeded = function(event) {
            if (onUpgradeNeeded) {
                onUpgradeNeeded(event.target.result);
            }
        };
        request.onsuccess = function(event) {
            resolve(event.target.result);
        };
        request.onerror = function(event) {
            reject(event.target.error);
        };
    });
}

function transactionDone(tx) {
    return new Promise(function(resolve, reject) {
        tx.oncomplete = function() {
            resolve();
        };
        tx.onerror = function(event) {
            reject(event.target.error);
        };
        tx.onabort = function(event) {
            reject(event.target.error);
        };
    });
}
