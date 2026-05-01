const { test, expect } = require("@playwright/test");
const path = require("path");

const chatKeyBase64 = "AAAAAAAAAAAAAAAAAAAAAA==";

async function routeJoinChatWorktreeStatic(page) {
  await page.route("**/html/joinchat.html**", async (route) => {
    await route.fulfill({
      contentType: "text/html",
      path: path.join(__dirname, "../../static/html/joinchat.html"),
    });
  });

  await page.route("**/js/chat/chat.js**", async (route) => {
    await route.fulfill({
      contentType: "application/javascript",
      path: path.join(__dirname, "../../static/js/chat/chat.js"),
    });
  });

  await page.route("**/css/chat.css**", async (route) => {
    await route.fulfill({
      contentType: "text/css",
      path: path.join(__dirname, "../../static/css/chat.css"),
    });
  });
}

function installJoinChatMocks() {
  let isHidden = false;

  function base64ToArrayBuffer(value) {
    const raw = atob(value);
    const bytes = new Uint8Array(raw.length);

    for (let i = 0; i < raw.length; i++) {
      bytes[i] = raw.charCodeAt(i);
    }

    return bytes.buffer;
  }

  function arrayBufferToBase64(value) {
    return btoa(String.fromCharCode(...new Uint8Array(value)));
  }

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
  window.__encryptJoinChatMessage = async (text) => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const key = await crypto.subtle.importKey(
      "raw",
      base64ToArrayBuffer(params.get("key")),
      { name: "AES-GCM", length: 128 },
      false,
      ["encrypt"]
    );
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      new TextEncoder().encode(text)
    );

    return {
      alg: "AES-GCM-128",
      iv: arrayBufferToBase64(iv),
      ciphertext: arrayBufferToBase64(ciphertext),
    };
  };
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(installJoinChatMocks);
});

async function openJoinChat(page) {
  await routeJoinChatWorktreeStatic(page);
  await page.goto(
    `/html/joinchat.html?id=chat-id#key=${encodeURIComponent(chatKeyBase64)}`
  );
  await page.waitForFunction(() => Boolean(window.__technochatMockSocket));
}

async function openJoinChatScript(page) {
  await routeJoinChatWorktreeStatic(page);
  await page.goto(
    `/html/joinchat.html?id=chat-id#key=${encodeURIComponent(chatKeyBase64)}`
  );
  await page.waitForFunction(() => typeof window.onfocus === "function");
}

test("@unit keeps the unread title until the tab receives focus", async ({
  page,
}) => {
  await openJoinChat(page);

  await expect(page.locator("#chat-messages")).toBeVisible();
  await expect(page).toHaveTitle("TechnoChat");

  await page.evaluate(async () => {
    window.__setJoinChatHiddenState(true);
    window.__emitJoinChatMessage({
      type: 1,
      username: "alice",
      data: await window.__encryptJoinChatMessage("hello from hidden tab"),
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

test("@unit does not blink the page title when the chat page is visible", async ({
  page,
}) => {
  await openJoinChat(page);

  await expect(page.locator("#chat-messages")).toBeVisible();
  await expect(page).toHaveTitle("TechnoChat");

  await page.evaluate(async () => {
    window.__setJoinChatHiddenState(false);
    window.__emitJoinChatMessage({
      type: 1,
      username: "bob",
      created_at: "2026-05-01T06:07:08Z",
      data: await window.__encryptJoinChatMessage("visible message"),
    });
  });

  await page.waitForTimeout(1_200);

  await expect(page).toHaveTitle("TechnoChat");
  await expect(page.locator("#chat-messages")).toContainText("bob");
  await expect(page.locator("#chat-messages")).toContainText("visible message");
  await expect(page.locator(".chat-message_time")).toBeVisible();
  await expect(page.locator(".chat-message_time")).toHaveAttribute(
    "datetime",
    "2026-05-01T06:07:08.000Z"
  );
  await expect(page.locator(".chat-message_time")).not.toBeEmpty();
});

test("@unit keeps chat input fixed while messages scroll internally", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openJoinChat(page);

  await page.evaluate(async () => {
    window.__setJoinChatHiddenState(false);

    for (let i = 0; i < 20; i++) {
      window.__emitJoinChatMessage({
        type: 1,
        username: "Axe",
        created_at: "2026-05-01T06:07:08Z",
        data: await window.__encryptJoinChatMessage("Hi"),
      });
    }
  });

  const layout = await page.evaluate(() => {
    const messages = document.getElementById("chat-messages");
    const input = document.querySelector(".message_input");
    const inputRect = input.getBoundingClientRect();

    return {
      bodyScrollHeight: document.documentElement.scrollHeight,
      viewportHeight: window.innerHeight,
      messagesClientHeight: messages.clientHeight,
      messagesScrollHeight: messages.scrollHeight,
      inputBottom: inputRect.bottom,
    };
  });

  expect(layout.bodyScrollHeight).toBeLessThanOrEqual(
    layout.viewportHeight + 1
  );
  expect(layout.messagesScrollHeight).toBeGreaterThan(
    layout.messagesClientHeight
  );
  expect(layout.inputBottom).toBeLessThanOrEqual(layout.viewportHeight);
});

test("@unit keeps the original title when focus returns before any unread notification", async ({
  page,
}) => {
  await openJoinChatScript(page);

  await expect(page.locator("#chat-messages")).toBeVisible();
  await expect(page).toHaveTitle("TechnoChat");

  await page.evaluate(() => {
    window.onfocus();
  });

  await expect(page).toHaveTitle("TechnoChat");
});

test("@unit encrypts outbound chat messages before WebSocket send", async ({
  page,
}) => {
  await openJoinChat(page);

  await page.evaluate(() => {
    window.__emitJoinChatMessage({
      type: 0,
      data: {
        event_id: 0,
        event_data: "alice",
      },
    });
  });

  await page.locator('input[type="text"]').fill("server must not read this");
  await page.locator('input[type="text"]').press("Enter");

  const payload = await page.waitForFunction(() => {
    const sent = window.__technochatMockSocket.lastSentPayload;

    if (!sent) {
      return false;
    }

    return JSON.parse(sent);
  });
  const sentMessage = await payload.jsonValue();

  expect(JSON.stringify(sentMessage)).not.toContain("server must not read this");
  expect(sentMessage.data.alg).toBe("AES-GCM-128");
  expect(sentMessage.data.iv).toBeTruthy();
  expect(sentMessage.data.ciphertext).toBeTruthy();

  const decrypted = await page.evaluate(async (encryptedPayload) => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const keyBytes = Uint8Array.from(atob(params.get("key")), (char) =>
      char.charCodeAt(0)
    );
    const key = await crypto.subtle.importKey(
      "raw",
      keyBytes,
      { name: "AES-GCM", length: 128 },
      false,
      ["decrypt"]
    );
    const iv = Uint8Array.from(atob(encryptedPayload.iv), (char) =>
      char.charCodeAt(0)
    );
    const ciphertext = Uint8Array.from(
      atob(encryptedPayload.ciphertext),
      (char) => char.charCodeAt(0)
    );
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      ciphertext
    );

    return new TextDecoder().decode(plain);
  }, sentMessage.data);

  expect(decrypted).toBe("server must not read this");
});

test("@unit shows online count and scrollable online users popup", async ({
  page,
}) => {
  await openJoinChat(page);

  await page.evaluate(() => {
    window.__emitJoinChatMessage({
      type: 0,
      data: {
        event_id: 3,
        event_data: {
          online: 4,
          max: 8,
          users: [
            { id: 1, name: "Abaddon" },
            { id: 2, name: "Lina" },
            { id: 3, name: "Pudge" },
            { id: 4, name: "Crystal Maiden" },
          ],
        },
      },
    });
  });

  await expect(page.locator(".presence_button")).toHaveText("4 (8) online");

  await page.locator(".presence_button").click();

  const popup = page.locator(".presence_panel");
  await expect(popup).toBeVisible();
  await expect(popup.locator(".presence_user")).toHaveCount(4);
  await expect(popup).toContainText("Crystal Maiden");

  const overflowY = await page.locator(".presence_list").evaluate((element) => {
    return window.getComputedStyle(element).overflowY;
  });
  expect(overflowY).toBe("auto");
});
