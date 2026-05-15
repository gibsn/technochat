const { test, expect } = require("@playwright/test");
const path = require("path");

test.beforeEach(async ({ page }) => {
  await page.route("**/push-subscription-test.html", async (route) => {
    await route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>push subscription test</title>",
    });
  });

  await page.route("**/js/chat/push-subscription.js", async (route) => {
    await route.fulfill({
      contentType: "application/javascript",
      path: path.join(__dirname, "../../static/js/chat/push-subscription.js"),
    });
  });
});

test("@unit detects push subscription VAPID key mismatches", async ({ page }) => {
  await page.goto("/push-subscription-test.html");

  const decisions = await page.evaluate(async () => {
    const module = await import("/js/chat/push-subscription.js");
    const currentKey = new Uint8Array([1, 2, 3]).buffer;

    return {
      sameKey: module.subscriptionMatchesApplicationServerKey({
        options: { applicationServerKey: new Uint8Array([1, 2, 3]).buffer },
      }, currentKey),
      differentKey: module.subscriptionMatchesApplicationServerKey({
        options: { applicationServerKey: new Uint8Array([1, 2, 4]).buffer },
      }, currentKey),
      missingKey: module.subscriptionMatchesApplicationServerKey({
        options: {},
      }, currentKey),
    };
  });

  await expect(decisions).toEqual({
    sameKey: true,
    differentKey: false,
    missingKey: true,
  });
});
