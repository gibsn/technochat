const { test, expect } = require("@playwright/test");
const path = require("path");

test.beforeEach(async ({ page }) => {
  await page.route("**/service-worker-notifications-test.html", async (route) => {
    await route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>service worker notifications test</title><script src=\"/sw.js\"></script>",
    });
  });

  await page.route("**/sw.js", async (route) => {
    await route.fulfill({
      contentType: "application/javascript",
      path: path.join(__dirname, "../../static/sw.js"),
    });
  });
});

test("@unit closes only older notifications for the opened chat", async ({ page }) => {
  await page.goto("/service-worker-notifications-test.html");

  const decisions = await page.evaluate(() => {
    const opened = {
      chatId: "chat-id",
      messageId: "opened",
      messageSeq: 3,
      timestamp: "2026-05-14T03:00:00Z",
    };

    return {
      olderSameChat: shouldCloseOlderChatNotification(opened, {
        chatId: "chat-id",
        messageId: "older",
        messageSeq: 2,
      }),
      openedMessage: shouldCloseOlderChatNotification(opened, {
        chatId: "chat-id",
        messageId: "opened",
        messageSeq: 3,
      }),
      newerSameChat: shouldCloseOlderChatNotification(opened, {
        chatId: "chat-id",
        messageId: "newer",
        messageSeq: 4,
      }),
      otherChat: shouldCloseOlderChatNotification(opened, {
        chatId: "other-chat",
        messageId: "older",
        messageSeq: 1,
      }),
      legacySameChat: shouldCloseOlderChatNotification(opened, {
        chatId: "chat-id",
        messageId: "legacy",
      }),
    };
  });

  await expect(decisions).toEqual({
    olderSameChat: true,
    openedMessage: false,
    newerSameChat: false,
    otherChat: false,
    legacySameChat: true,
  });
});

test("@unit falls back to timestamps when notification sequence is absent", async ({ page }) => {
  await page.goto("/service-worker-notifications-test.html");

  const decisions = await page.evaluate(() => {
    const opened = {
      chatId: "chat-id",
      messageId: "opened",
      timestamp: "2026-05-14T03:00:00Z",
    };

    return {
      olderSameChat: shouldCloseOlderChatNotification(opened, {
        chatId: "chat-id",
        messageId: "older",
        timestamp: "2026-05-14T02:00:00Z",
      }),
      newerSameChat: shouldCloseOlderChatNotification(opened, {
        chatId: "chat-id",
        messageId: "newer",
        timestamp: "2026-05-14T04:00:00Z",
      }),
    };
  });

  await expect(decisions).toEqual({
    olderSameChat: true,
    newerSameChat: false,
  });
});
