const { test, expect } = require("@playwright/test");

test("@e2e creates a temporary chat and exchanges messages over WebSocket", async ({
  page,
  browser,
}) => {
  await page.goto("/html/initchat.html", { waitUntil: "domcontentloaded" });
  await page.locator("button", { hasText: "Create chat" }).click();

  const linkInput = page.locator("#to_copy");
  await expect(linkInput).toHaveValue(/\/html\/joinchat\.html\?id=.*#key=.*/);
  const chatLink = await linkInput.inputValue();

  const firstUserPage = await browser.newPage();
  const secondUserPage = await browser.newPage();
  const thirdUserPage = await browser.newPage();

  try {
    await firstUserPage.goto(chatLink, { waitUntil: "domcontentloaded" });
    await secondUserPage.goto(chatLink, { waitUntil: "domcontentloaded" });

    await expect(firstUserPage.locator("#chat-messages")).toContainText(
      "has joined"
    );
    await expect(secondUserPage.locator("#chat-messages")).toContainText(
      "has joined"
    );

    await firstUserPage.locator('input[type="text"]').fill("hello from chat e2e");
    await firstUserPage.locator("button", { hasText: "Send" }).click();

    await expect(firstUserPage.locator("#chat-messages")).toContainText(
      "hello from chat e2e"
    );
    await expect(secondUserPage.locator("#chat-messages")).toContainText(
      "hello from chat e2e"
    );

    await thirdUserPage.goto(chatLink, { waitUntil: "domcontentloaded" });
    await expect(thirdUserPage.locator("#app")).toContainText(/chat is full/i);
  } finally {
    await firstUserPage.close();
    await secondUserPage.close();
    await thirdUserPage.close();
  }
});

test("@e2e reopens an invite link with stored reconnect token", async ({
  page,
  browser,
}) => {
  await page.goto("/html/initchat.html", { waitUntil: "domcontentloaded" });
  await page.locator("button", { hasText: "Create chat" }).click();

  const linkInput = page.locator("#to_copy");
  await expect(linkInput).toHaveValue(/\/html\/joinchat\.html\?id=.*#key=.*/);
  const chatLink = await linkInput.inputValue();
  const chatURL = new URL(chatLink);
  const chatID = chatURL.searchParams.get("id");

  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    serviceWorkers: "block",
  });
  const firstUserPage = await context.newPage();
  const quotaUserPage = await browser.newPage();
  const secondUserPage = await context.newPage();

  try {
    await firstUserPage.goto(chatLink, { waitUntil: "domcontentloaded" });
    await quotaUserPage.goto(chatLink, { waitUntil: "domcontentloaded" });
    await expect(firstUserPage.locator("#chat-messages")).toContainText(
      "has joined"
    );
    await expect(quotaUserPage.locator("#chat-messages")).toContainText(
      "has joined"
    );

    const storedSession = await firstUserPage.evaluate((id) => {
      return JSON.parse(localStorage.getItem(`technochat:chat:${id}`));
    }, chatID);
    expect(storedSession.reconnectToken).toBeTruthy();

    await firstUserPage.close();

    await secondUserPage.goto(chatLink, { waitUntil: "domcontentloaded" });
    await expect(secondUserPage.locator("#chat-messages")).toContainText(
      "has joined"
    );

    await secondUserPage
      .locator('input[type="text"]')
      .fill("hello after reconnect");
    await secondUserPage.locator("button", { hasText: "Send" }).click();
    await expect(secondUserPage.locator("#chat-messages")).toContainText(
      "hello after reconnect"
    );
    await expect(secondUserPage.locator("#app")).not.toContainText(
      /chat is full/i
    );
  } finally {
    await secondUserPage.close();
    await quotaUserPage.close();
    await context.close();
  }
});
