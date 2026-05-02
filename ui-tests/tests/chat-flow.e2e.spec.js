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
    await expect(thirdUserPage.locator("#app")).toContainText(/poshel nah/i);
  } finally {
    await firstUserPage.close();
    await secondUserPage.close();
    await thirdUserPage.close();
  }
});
