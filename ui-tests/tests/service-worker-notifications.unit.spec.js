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

test("@unit closes all notifications for the opened chat", async ({ page }) => {
  await page.goto("/service-worker-notifications-test.html");

  const decisions = await page.evaluate(() => {
    const opened = {
      chatId: "chat-id",
      messageId: "opened",
      messageSeq: 3,
      timestamp: "2026-05-14T03:00:00Z",
    };

    return {
      olderSameChat: shouldCloseChatNotification(opened, {
        chatId: "chat-id",
        messageId: "older",
        messageSeq: 2,
      }),
      openedMessage: shouldCloseChatNotification(opened, {
        chatId: "chat-id",
        messageId: "opened",
        messageSeq: 3,
      }),
      newerSameChat: shouldCloseChatNotification(opened, {
        chatId: "chat-id",
        messageId: "newer",
        messageSeq: 4,
      }),
      otherChat: shouldCloseChatNotification(opened, {
        chatId: "other-chat",
        messageId: "older",
        messageSeq: 1,
      }),
      legacySameChat: shouldCloseChatNotification(opened, {
        chatId: "chat-id",
        messageId: "legacy",
      }),
    };
  });

  await expect(decisions).toEqual({
    olderSameChat: true,
    openedMessage: true,
    newerSameChat: true,
    otherChat: false,
    legacySameChat: true,
  });
});

test("@unit ignores notification ordering when closing opened chat notifications", async ({ page }) => {
  await page.goto("/service-worker-notifications-test.html");

  const decisions = await page.evaluate(() => {
    const opened = {
      chatId: "chat-id",
      messageId: "opened",
      timestamp: "2026-05-14T03:00:00Z",
    };

    return {
      olderSameChat: shouldCloseChatNotification(opened, {
        chatId: "chat-id",
        messageId: "older",
        timestamp: "2026-05-14T02:00:00Z",
      }),
      newerSameChat: shouldCloseChatNotification(opened, {
        chatId: "chat-id",
        messageId: "newer",
        timestamp: "2026-05-14T04:00:00Z",
      }),
    };
  });

  await expect(decisions).toEqual({
    olderSameChat: true,
    newerSameChat: true,
  });
});
