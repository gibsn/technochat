const { test, expect } = require("@playwright/test");

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        async writeText(value) {
          window.__copiedText = value;
        },
      },
    });
  });
});

test("@unit resets the copy button when a new chat link is generated", async ({
  page,
}) => {
  let responseIndex = 0;
  const initRequestBodies = [];
  const chatIDs = ["first-chat", "second-chat"];

  await page.route("**/api/v1/chat/init", async (route) => {
    initRequestBodies.push(route.request().postData());
    const chatID = chatIDs[responseIndex];
    responseIndex += 1;

    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        code: 200,
        body: {
          id: chatID,
        },
      }),
    });
  });

  await page.goto("/html/initchat.html");
  await page.locator("button", { hasText: "Create chat" }).click();

  await expect(page.locator("#to_copy")).toHaveValue(
    /\/html\/joinchat\.html\?id=first-chat#key=/
  );
  await expect(page.locator("#join_button")).toHaveAttribute("target", "_blank");
  await expect(page.locator("#join_button")).toHaveAttribute("rel", "noopener");
  await page.locator("#copy_button").click();
  await expect(page.locator("#copy_button")).toHaveText("Copied!");

  await page.locator("button", { hasText: "Create chat" }).click();

  await expect(page.locator("#to_copy")).toHaveValue(
    /\/html\/joinchat\.html\?id=second-chat#key=/
  );
  await expect(page.locator("#copy_button")).toHaveText("Copy link");
  expect(initRequestBodies.join("\n")).not.toContain("key");
});

test("@unit shows a global loader while chat init request is pending", async ({
  page,
}) => {
  let finishRequest;
  const requestDone = new Promise((resolve) => {
    finishRequest = resolve;
  });

  await page.route("**/api/v1/chat/init", async (route) => {
    await requestDone;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        code: 200,
        body: {
          id: "loader-chat",
        },
      }),
    });
  });

  await page.goto("/html/initchat.html");
  await page.locator("button", { hasText: "Create chat" }).click();

  await expect(page.locator("#network_loader")).toHaveClass(
    /network-loader--visible/
  );

  finishRequest();

  await expect(page.locator("#to_copy")).toHaveValue(/loader-chat#key=/);
  await expect(page.locator("#network_loader")).not.toHaveClass(
    /network-loader--visible/
  );
});

test("@unit keeps Join in the same window and starts loader in PWA mode", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const originalMatchMedia = window.matchMedia.bind(window);
    window.matchMedia = (query) => {
      if (query === "(display-mode: standalone)") {
        return {
          matches: true,
          media: query,
          onchange: null,
          addListener() {},
          removeListener() {},
          addEventListener() {},
          removeEventListener() {},
          dispatchEvent() {
            return false;
          },
        };
      }

      return originalMatchMedia(query);
    };
  });

  await page.route("**/api/v1/chat/init", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        code: 200,
        body: {
          id: "pwa-chat",
        },
      }),
    });
  });

  await page.goto("/html/initchat.html");
  await page.locator("button", { hasText: "Create chat" }).click();

  const joinButton = page.locator("#join_button");
  await expect(joinButton).not.toHaveAttribute("target");
  await expect(joinButton).not.toHaveAttribute("rel");

  await joinButton.evaluate((button) => {
    button.addEventListener("click", (e) => e.preventDefault());
  });
  await joinButton.click();
  await expect(page.locator("#network_loader")).toHaveClass(
    /network-loader--visible/
  );
});
