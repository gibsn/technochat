const { test, expect } = require("@playwright/test");
const path = require("path");

test.beforeEach(async ({ page }) => {
  await page.route("**/push-message-test.html", async (route) => {
    await route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>push message test</title>",
    });
  });

  await page.route("**/js/chat/push-messages.js", async (route) => {
    await route.fulfill({
      contentType: "application/javascript",
      path: path.join(__dirname, "../../static/js/chat/push-messages.js"),
    });
  });
});

test("@unit deduplicates and sorts stored push messages", async ({ page }) => {
  await page.goto("/push-message-test.html");

  const messages = await page.evaluate(async () => {
    async function deletePushDB() {
      await new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase("technochat-push-messages");
        request.onsuccess = () => resolve();
        request.onerror = (event) => reject(event.target.error);
        request.onblocked = () => resolve();
      });
    }

    await deletePushDB();

    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("technochat-push-messages", 1);
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        const store = db.createObjectStore("messages", { keyPath: "key" });
        store.createIndex("chatId", "chatId", { unique: false });
      };
      request.onsuccess = (event) => resolve(event.target.result);
      request.onerror = (event) => reject(event.target.error);
    });

    await new Promise((resolve, reject) => {
      const tx = db.transaction("messages", "readwrite");
      const store = tx.objectStore("messages");
      [
        { messageId: "late", messageSeq: 3, timestamp: "2026-05-03T01:00:00Z" },
        { messageId: "early", messageSeq: 1, timestamp: "2026-05-03T03:00:00Z" },
        { messageId: "fallback-new", timestamp: "2026-05-03T05:00:00Z" },
        { messageId: "fallback-old", timestamp: "2026-05-03T04:00:00Z" },
        { messageId: "early", messageSeq: 1, timestamp: "2026-05-03T03:00:00Z" },
      ].forEach((message, index) => {
        store.put({
          key: `chat-id:${message.messageId}:${index}`,
          chatId: "chat-id",
          sender: "alice",
          data: { alg: "AES-GCM-128", iv: "iv", ciphertext: "ciphertext" },
          ...message,
        });
      });
      tx.oncomplete = () => resolve();
      tx.onerror = (event) => reject(event.target.error);
    });
    db.close();

    const module = await import("/js/chat/push-messages.js");
    return (await module.readPushMessages("chat-id")).map((message) => message.messageId);
  });

  await expect(messages).toEqual(["early", "late", "fallback-old", "fallback-new"]);
});

test("@unit deletes rendered push messages", async ({ page }) => {
  await page.goto("/push-message-test.html");

  const remaining = await page.evaluate(async () => {
    async function deletePushDB() {
      await new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase("technochat-push-messages");
        request.onsuccess = () => resolve();
        request.onerror = (event) => reject(event.target.error);
        request.onblocked = () => resolve();
      });
    }

    await deletePushDB();
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("technochat-push-messages", 1);
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        const store = db.createObjectStore("messages", { keyPath: "key" });
        store.createIndex("chatId", "chatId", { unique: false });
      };
      request.onsuccess = (event) => resolve(event.target.result);
      request.onerror = (event) => reject(event.target.error);
    });

    await new Promise((resolve, reject) => {
      const tx = db.transaction("messages", "readwrite");
      const store = tx.objectStore("messages");
      ["early", "late"].forEach((messageId, index) => {
        store.put({
          key: `chat-id:${messageId}`,
          chatId: "chat-id",
          messageId,
          messageSeq: index + 1,
          sender: "alice",
          data: { alg: "AES-GCM-128", iv: "iv", ciphertext: "ciphertext" },
          timestamp: `2026-05-03T0${index + 1}:00:00Z`,
        });
      });
      tx.oncomplete = () => resolve();
      tx.onerror = (event) => reject(event.target.error);
    });
    db.close();

    const module = await import("/js/chat/push-messages.js");
    await module.deletePushMessages("chat-id", ["early", "late"]);
    return (await module.readPushMessages("chat-id")).map((message) => message.messageId);
  });

  await expect(remaining).toEqual([]);
});
