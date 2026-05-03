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

  await page.route("**/js/chat/reconnect-session.js**", async (route) => {
    await route.fulfill({
      contentType: "application/javascript",
      path: path.join(__dirname, "../../static/js/chat/reconnect-session.js"),
    });
  });

  await page.route("**/js/chat/push-subscription.js**", async (route) => {
    await route.fulfill({
      contentType: "application/javascript",
      path: path.join(__dirname, "../../static/js/chat/push-subscription.js"),
    });
  });

  await page.route("**/js/chat/push-messages.js**", async (route) => {
    await route.fulfill({
      contentType: "application/javascript",
      path: path.join(__dirname, "../../static/js/chat/push-messages.js"),
    });
  });

  await page.route("**/js/restricted-webview.js**", async (route) => {
    await route.fulfill({
      contentType: "application/javascript",
      path: path.join(__dirname, "../../static/js/restricted-webview.js"),
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
      if (!window.__technochatMockSockets) {
        window.__technochatMockSockets = [];
      }
      window.__technochatMockSockets.push(this);
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
      if (!this.sentPayloads) {
        this.sentPayloads = [];
      }
      this.sentPayloads.push(payload);
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
    `/html/joinchat.html?id=chat-id#key=${encodeURIComponent(chatKeyBase64)}`,
    { waitUntil: "commit" }
  );
  await page.waitForFunction(() => Boolean(window.__technochatMockSocket));
}

async function openJoinChatScript(page) {
  await routeJoinChatWorktreeStatic(page);
  await page.goto(
    `/html/joinchat.html?id=chat-id#key=${encodeURIComponent(chatKeyBase64)}`,
    { waitUntil: "commit" }
  );
  await page.waitForFunction(() => typeof window.onfocus === "function");
}

async function openJoinChatWithStoredReconnectToken(
  page,
  reconnectToken,
  name = "stored-name"
) {
  await routeJoinChatWorktreeStatic(page);
  await page.addInitScript(({ token, storedName, roomKey }) => {
    localStorage.setItem(
      "technochat:chat:chat-id",
      JSON.stringify({
        chatId: "chat-id",
        reconnectToken: token,
        name: storedName,
        roomKey,
        updatedAt: "2026-05-02T06:00:00.000Z",
      })
    );
  }, { token: reconnectToken, storedName: name, roomKey: chatKeyBase64 });
  await page.goto(
    `/html/joinchat.html?id=chat-id#key=${encodeURIComponent(chatKeyBase64)}`,
    { waitUntil: "commit" }
  );
  await page.waitForFunction(() => Boolean(window.__technochatMockSocket));
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

test("@unit keeps the page gray behind the white chat canvas", async ({ page }) => {
  await routeJoinChatWorktreeStatic(page);
  await page.addInitScript(installJoinChatMocks);

  await page.goto(
    `/html/joinchat.html?id=chat-id#key=${encodeURIComponent(chatKeyBase64)}`
  );
  await expect(page.locator("#chat-messages")).toBeVisible();

  await expect(page.locator("html")).toHaveCSS(
    "background-color",
    "rgb(221, 221, 221)"
  );
  await expect(page.locator(".chat_content")).toHaveCSS(
    "background-color",
    "rgba(255, 255, 255, 0.88)"
  );
});

test("@unit shows a global loader while chat WebSocket connects", async ({
  page,
}) => {
  await routeJoinChatWorktreeStatic(page);
  await page.addInitScript(installJoinChatMocks);

  await page.goto(
    `/html/joinchat.html?id=chat-id#key=${encodeURIComponent(chatKeyBase64)}`
  );

  await expect(page.locator("#network_loader")).toHaveClass(
    /network-loader--visible/
  );

  await page.evaluate(() => {
    window.__technochatMockSocket.dispatch("open");
  });

  await expect(page.locator("#network_loader")).not.toHaveClass(
    /network-loader--visible/
  );
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

test("@unit preserves existing avatar nodes when a new message arrives", async ({
  page,
}) => {
  await openJoinChat(page);

  await page.evaluate(async () => {
    window.__emitJoinChatMessage({
      type: 1,
      username: "Axe",
      data: await window.__encryptJoinChatMessage("first"),
    });
  });

  await expect(page.locator(".chat-message .chip img")).toHaveCount(1);
  await page.locator(".chat-message .chip img").first().evaluate((img) => {
    img.dataset.persistedAvatar = "yes";
  });

  await page.evaluate(async () => {
    window.__emitJoinChatMessage({
      type: 1,
      username: "Lina",
      data: await window.__encryptJoinChatMessage("second"),
    });
  });

  await expect(page.locator(".chat-message .chip img")).toHaveCount(2);
  await expect(page.locator(".chat-message .chip img").first()).toHaveAttribute(
    "data-persisted-avatar",
    "yes"
  );
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
        event_data: {
          name: "alice",
          reconnect_token: "token-alice",
        },
      },
    });
    window.$ = undefined;
  });

  await page.locator('input[type="text"]').fill("server must not read this");
  await page.locator('input[type="text"]').press("Enter");

  const payload = await page.waitForFunction(() => {
    const sent = (window.__technochatMockSocket.sentPayloads || []).find(
      (payload) => JSON.parse(payload).type === 1
    );

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

test("@unit stores reconnect token after the first chat connection", async ({
  page,
}) => {
  await openJoinChat(page);

  await page.evaluate(() => {
    window.__emitJoinChatMessage({
      type: 0,
      data: {
        event_id: 0,
        event_data: {
          name: "alice",
          reconnect_token: "token-alice",
        },
      },
    });
  });

  const storedSession = await page.evaluate(() => {
    return JSON.parse(localStorage.getItem("technochat:chat:chat-id"));
  });

  expect(storedSession).toEqual({
    chatId: "chat-id",
    reconnectToken: "token-alice",
    name: "alice",
    roomKey: chatKeyBase64,
    updatedAt: expect.any(String),
  });
});

test("@unit uses reconnect websocket endpoint when a token is stored", async ({
  page,
}) => {
  await openJoinChatWithStoredReconnectToken(page, "stored-token", "Tiny");

  const socketURL = await page.evaluate(() => window.__technochatMockSocket.url);
  expect(socketURL).toContain("/api/v1/chat/reconnect");
  expect(socketURL).toContain("reconnect_token=stored-token");
  await expect(page.locator(".connection_status")).toHaveText(
    "Reconnecting as Tiny..."
  );
});

test("@unit can reconnect from stored room key when URL hash is missing", async ({
  page,
}) => {
  await routeJoinChatWorktreeStatic(page);
  await page.addInitScript((roomKey) => {
    localStorage.setItem(
      "technochat:chat:chat-id",
      JSON.stringify({
        chatId: "chat-id",
        reconnectToken: "stored-token",
        name: "Tiny",
        roomKey,
        updatedAt: "2026-05-02T06:00:00.000Z",
      })
    );
  }, chatKeyBase64);

  await page.goto("/html/joinchat.html?id=chat-id", { waitUntil: "commit" });
  await page.waitForFunction(() => Boolean(window.__technochatMockSocket));

  const socketURL = await page.evaluate(() => window.__technochatMockSocket.url);
  expect(socketURL).toContain("/api/v1/chat/reconnect");
  expect(socketURL).toContain("reconnect_token=stored-token");
});

test("@unit local leave clears reconnect token without returning chat quota", async ({
  page,
}) => {
  await openJoinChat(page);

  await page.evaluate(() => {
    window.__emitJoinChatMessage({
      type: 0,
      data: {
        event_id: 0,
        event_data: {
          name: "alice",
          reconnect_token: "token-alice",
        },
      },
    });
  });

  await expect(page.locator(".leave_button")).toBeVisible();
  await page.locator(".leave_button").click();

  await expect
    .poll(async () =>
      page.evaluate(() => localStorage.getItem("technochat:chat:chat-id"))
    )
    .toBeNull();
  await expect(page).toHaveURL(/\/html\/messageadd\.html$/);
});

test("@unit warns when chat is opened inside Telegram webview", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.Telegram = { WebApp: {} };
  });
  await openJoinChat(page);

  await expect(page.locator(".webview_warning")).toContainText("Telegram");
});

test("@unit clears invalid reconnect token and falls back to first connect", async ({
  page,
}) => {
  await openJoinChatWithStoredReconnectToken(page, "bad-token");

  await page.evaluate(() => {
    window.__emitJoinChatMessage({
      type: 0,
      data: {
        event_id: 5,
      },
    });
  });

  await page.waitForFunction(() => window.__technochatMockSockets.length === 2);

  const state = await page.evaluate(() => {
    return {
      storedSession: localStorage.getItem("technochat:chat:chat-id"),
      socketURLs: window.__technochatMockSockets.map((socket) => socket.url),
    };
  });

  expect(state.storedSession).toBeNull();
  expect(state.socketURLs[0]).toContain("/api/v1/chat/reconnect");
  expect(state.socketURLs[1]).toContain("/api/v1/chat/connect");
});

test("@unit retries the first websocket connect before showing connection lost", async ({
  page,
}) => {
  await openJoinChat(page);

  await page.evaluate(() => {
    const socket = window.__technochatMockSocket;
    socket.readyState = 3;
    socket.dispatch("error");
    socket.dispatch("close", {
      code: 1006,
      reason: "",
      wasClean: false,
    });
  });

  await expect(page.locator("#app")).not.toContainText("Connection lost");
  await expect(page.locator(".connection_status")).toHaveText("Connecting...");

  await page.waitForFunction(() => window.__technochatMockSockets.length === 2);

  const socketURLs = await page.evaluate(() => {
    return window.__technochatMockSockets.map((socket) => socket.url);
  });

  expect(socketURLs[0]).toContain("/api/v1/chat/connect");
  expect(socketURLs[1]).toContain("/api/v1/chat/connect");
});

test("@unit shows a manual reconnect button after connect retries fail", async ({
  page,
}) => {
  await openJoinChat(page);

  await page.evaluate(() => {
    const sockets = window.__technochatMockSockets;
    const socket = sockets[sockets.length - 1];
    socket.readyState = 3;
    socket.dispatch("error");
    socket.dispatch("close", {
      code: 1006,
      reason: "",
      wasClean: false,
    });
  });
  await page.waitForFunction(() => window.__technochatMockSockets.length === 2);

  await page.evaluate(() => {
    const sockets = window.__technochatMockSockets;
    const socket = sockets[sockets.length - 1];
    socket.readyState = 3;
    socket.dispatch("error");
    socket.dispatch("close", {
      code: 1006,
      reason: "",
      wasClean: false,
    });
  });
  await page.waitForFunction(() => window.__technochatMockSockets.length === 3);

  await page.evaluate(() => {
    const sockets = window.__technochatMockSockets;
    const socket = sockets[sockets.length - 1];
    socket.readyState = 3;
    socket.dispatch("error");
    socket.dispatch("close", {
      code: 1006,
      reason: "",
      wasClean: false,
    });
  });

  await expect(page.locator(".chat_error")).toContainText("Connection lost");
  await expect(page.locator(".chat_error_reconnect")).toHaveText("Reconnect");

  await page.locator(".chat_error_reconnect").click();
  await page.waitForFunction(() => window.__technochatMockSockets.length === 4);

  const socketURLs = await page.evaluate(() => {
    return window.__technochatMockSockets.map((socket) => socket.url);
  });

  expect(socketURLs[3]).toContain("/api/v1/chat/connect");
  await expect(page.locator(".chat_error_reconnect")).toBeHidden();
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

test("@unit sends throttled typing events while composing", async ({ page }) => {
  await openJoinChat(page);

  await page.locator('input[type="text"]').fill("h");
  await page.locator('input[type="text"]').fill("he");

  const sentPayloads = await page.evaluate(() => {
    return (window.__technochatMockSocket.sentPayloads || []).map((payload) =>
      JSON.parse(payload)
    );
  });
  const typingPayloads = sentPayloads.filter((payload) => {
    return payload.type === 0 && payload.data && payload.data.event_id === 4;
  });

  expect(typingPayloads).toHaveLength(1);
});

test("@unit shows typing indicator and clears it after expires_at", async ({
  page,
}) => {
  await openJoinChat(page);

  await page.evaluate(() => {
    window.__emitJoinChatMessage({
      type: 0,
      data: {
        event_id: 4,
        event_data: [
          {
            id: 1,
            name: "Lina",
            expires_at: new Date(Date.now() + 500).toISOString(),
          },
        ],
      },
    });
  });

  await expect(page.locator(".typing_indicator")).toContainText(
    "Lina is typing"
  );
  await expect(page.locator(".typing_dots i")).toHaveCount(3);

  await expect(page.locator(".typing_indicator")).toBeHidden({
    timeout: 2_000,
  });
});

test("@unit keeps typing indicator while expires_at is refreshed", async ({
  page,
}) => {
  await openJoinChat(page);

  await page.evaluate(() => {
    window.__emitJoinChatMessage({
      type: 0,
      data: {
        event_id: 4,
        event_data: [
          {
            id: 1,
            name: "Lina",
            expires_at: new Date(Date.now() + 350).toISOString(),
          },
        ],
      },
    });
  });

  await expect(page.locator(".typing_indicator")).toContainText(
    "Lina is typing"
  );

  await page.waitForTimeout(150);
  await page.evaluate(() => {
    window.__emitJoinChatMessage({
      type: 0,
      data: {
        event_id: 4,
        event_data: [
          {
            id: 1,
            name: "Lina",
            expires_at: new Date(Date.now() + 1_200).toISOString(),
          },
        ],
      },
    });
  });

  await page.waitForTimeout(500);
  await expect(page.locator(".typing_indicator")).toContainText(
    "Lina is typing"
  );
});
