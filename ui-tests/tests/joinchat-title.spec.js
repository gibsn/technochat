const { test, expect } = require("@playwright/test");

function installJoinChatMocks() {
  let isHidden = false;

  Object.defineProperty(Document.prototype, "hidden", {
    configurable: true,
    get() {
      return isHidden;
    },
  });

  Object.defineProperty(Document.prototype, "visibilityState", {
    configurable: true,
    get() {
      return isHidden ? "hidden" : "visible";
    },
  });

  class MockWebSocket {
    constructor(url) {
      this.url = url;
      this.listeners = {};
      this.readyState = 1;
      window.__technochatMockSocket = this;
    }

    addEventListener(type, callback) {
      if (!this.listeners[type]) {
        this.listeners[type] = [];
      }

      this.listeners[type].push(callback);
    }

    send(payload) {
      this.lastSentPayload = payload;
    }

    close() {
      this.readyState = 3;
      this.dispatch("close");
    }

    dispatch(type, event = {}) {
      const listeners = this.listeners[type] || [];
      listeners.forEach((callback) => callback(event));
    }
  }

  window.WebSocket = MockWebSocket;
  window.__setJoinChatHiddenState = (value) => {
    isHidden = value;
  };
  window.__emitJoinChatMessage = (payload) => {
    window.__technochatMockSocket.dispatch("message", {
      data: JSON.stringify(payload),
    });
  };
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(installJoinChatMocks);
});

async function openJoinChat(page) {
  await page.goto("/html/joinchat.html?id=chat-id");
  await page.waitForFunction(() => Boolean(window.__technochatMockSocket));
}

test("keeps the unread title until the tab receives focus", async ({
  page,
}) => {
  await openJoinChat(page);

  await expect(page.locator("#chat-messages")).toBeVisible();
  await expect(page).toHaveTitle("TechnoChat");

  await page.evaluate(() => {
    window.__setJoinChatHiddenState(true);
    window.__emitJoinChatMessage({
      type: 1,
      username: "alice",
      data: "hello from hidden tab",
    });
  });

  await expect
    .poll(async () => page.title(), {
      message: "the title should switch to the unread message marker",
      timeout: 2_500,
    })
    .toBe("New message!");

  await page.waitForTimeout(4_000);
  await expect(page).toHaveTitle("New message!");

  await page.evaluate(() => {
    window.__setJoinChatHiddenState(false);
    window.onfocus();
  });

  await expect(page).toHaveTitle("TechnoChat");
  await expect(page.locator("#chat-messages")).toContainText("alice");
  await expect(page.locator("#chat-messages")).toContainText(
    "hello from hidden tab"
  );
});

test("does not blink the page title when the chat page is visible", async ({
  page,
}) => {
  await openJoinChat(page);

  await expect(page.locator("#chat-messages")).toBeVisible();
  await expect(page).toHaveTitle("TechnoChat");

  await page.evaluate(() => {
    window.__setJoinChatHiddenState(false);
    window.__emitJoinChatMessage({
      type: 1,
      username: "bob",
      data: "visible message",
    });
  });

  await page.waitForTimeout(1_200);

  await expect(page).toHaveTitle("TechnoChat");
  await expect(page.locator("#chat-messages")).toContainText("bob");
  await expect(page.locator("#chat-messages")).toContainText("visible message");
});

test("keeps the original title when focus returns before any unread notification", async ({
  page,
}) => {
  await openJoinChat(page);

  await expect(page.locator("#chat-messages")).toBeVisible();
  await expect(page).toHaveTitle("TechnoChat");

  await page.evaluate(() => {
    window.onfocus();
  });

  await expect(page).toHaveTitle("TechnoChat");
});
