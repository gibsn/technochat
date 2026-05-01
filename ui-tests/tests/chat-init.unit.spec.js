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
  await page.locator("#copy_button").click();
  await expect(page.locator("#copy_button")).toHaveText("Copied!");

  await page.locator("button", { hasText: "Create chat" }).click();

  await expect(page.locator("#to_copy")).toHaveValue(
    /\/html\/joinchat\.html\?id=second-chat#key=/
  );
  await expect(page.locator("#copy_button")).toHaveText("Copy link");
  expect(initRequestBodies.join("\n")).not.toContain("key");
});
