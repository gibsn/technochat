const { test, expect } = require("@playwright/test");
const path = require("path");

test.beforeEach(async ({ page }) => {
  await page.route("**/push-subscription-test.html", async (route) => {
    await route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>push subscription test</title>",
    });
  });

  await page.route("**/js/chat/push-subscription.js**", async (route) => {
    await route.fulfill({
      contentType: "application/javascript",
      path: path.join(__dirname, "../../static/js/chat/push-subscription.js"),
    });
  });
});

test("@unit does not request notification permission when push is disabled", async ({ page }) => {
  await page.route("**/api/v1/push/vapid-public-key", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        code: 200,
        body: {
          enabled: false,
          public_key: "",
        },
      }),
    });
  });

  await page.goto("/push-subscription-test.html");

  const result = await page.evaluate(async () => {
    let permissionRequested = false;
    let serviceWorkerRegistered = false;

    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: {
        permission: "default",
        requestPermission: async () => {
          permissionRequested = true;
          return "granted";
        },
      },
    });
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        register: async () => {
          serviceWorkerRegistered = true;
          return {};
        },
      },
    });
    Object.defineProperty(window, "PushManager", {
      configurable: true,
      value: function PushManager() {},
    });

    const module = await import("/js/chat/push-subscription.js?disabled-vapid-test");
    const subscription = await module.currentPushSubscription(true);

    return {
      permissionRequested,
      serviceWorkerRegistered,
      subscription,
    };
  });

  expect(result).toEqual({
    permissionRequested: false,
    serviceWorkerRegistered: false,
    subscription: null,
  });
});

test("@unit requests notification permission after VAPID key is preloaded", async ({ page }) => {
  await page.route("**/api/v1/push/vapid-public-key", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        code: 200,
        body: {
          enabled: true,
          public_key: "AQID",
        },
      }),
    });
  });

  await page.goto("/push-subscription-test.html");

  const result = await page.evaluate(async () => {
    let permissionRequested = false;
    let serviceWorkerRegistered = false;
    let subscribed = false;

    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: {
        permission: "default",
        requestPermission: async () => {
          permissionRequested = true;
          window.Notification.permission = "granted";
          return "granted";
        },
      },
    });
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        register: async () => {
          serviceWorkerRegistered = true;
          return {
            pushManager: {
              getSubscription: async () => null,
              subscribe: async () => {
                subscribed = true;
                return {
                  toJSON: () => ({
                    endpoint: "https://push.example/subscription",
                    keys: {
                      auth: "auth-key",
                      p256dh: "p256dh-key",
                    },
                  }),
                };
              },
            },
          };
        },
      },
    });
    Object.defineProperty(window, "PushManager", {
      configurable: true,
      value: function PushManager() {},
    });

    const module = await import("/js/chat/push-subscription.js?enabled-vapid-test");
    await module.preloadVAPIDPublicKey();
    const subscription = await module.currentPushSubscription(true);

    return {
      permissionRequested,
      serviceWorkerRegistered,
      subscribed,
      subscription,
    };
  });

  expect(result).toEqual({
    permissionRequested: true,
    serviceWorkerRegistered: true,
    subscribed: true,
    subscription: {
      endpoint: "https://push.example/subscription",
      keys: {
        auth: "auth-key",
        p256dh: "p256dh-key",
      },
    },
  });
});
