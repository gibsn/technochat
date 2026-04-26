const { test, expect } = require("@playwright/test");

test("@e2e creates, opens, decrypts, and consumes a one-time message", async ({
  page,
  browser,
}) => {
  const messageText = "secret from playwright\nsecond line";

  await page.goto("/html/messageadd.html");
  await page.locator("#text").fill(messageText);
  await page.locator("#generate_button").click();

  const linkInput = page.locator("#to_copy");
  await expect(linkInput).toHaveValue(
    /\/html\/messageview\.html\?id=.*#key=.*&iv=.*/
  );

  const messageLink = await linkInput.inputValue();
  await page.goto(messageLink);

  await expect(page.locator("#message")).toContainText("secret from playwright");
  await expect(page.locator("#message")).toContainText("second line");

  await page.locator("#text").fill("reply from message view");
  await page.locator("#generate_button").click();

  const replyLinkInput = page.locator("#to_copy");
  await expect(replyLinkInput).toHaveValue(
    /\/html\/messageview\.html\?id=.*#key=.*&iv=.*/
  );
  const replyLink = await replyLinkInput.inputValue();

  const replyViewPage = await browser.newPage();
  try {
    await replyViewPage.goto(replyLink);
    await expect(replyViewPage.locator("#message")).toHaveText(
      "reply from message view"
    );
  } finally {
    await replyViewPage.close();
  }

  const secondViewPage = await browser.newPage();
  try {
    await secondViewPage.goto(messageLink);
    await expect(secondViewPage.locator("#message")).toHaveText(/not found/i);
  } finally {
    await secondViewPage.close();
  }
});
