const { test, expect } = require("@playwright/test");

const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64"
);

test("@e2e creates, opens, decrypts, and consumes a one-time message", async ({
  page,
  browser,
}) => {
  const messageText = "secret from playwright\nsecond line";

  await page.goto("/html/messageadd.html", { waitUntil: "domcontentloaded" });
  await page.locator("#text").fill(messageText);
  await page.locator("#generate_button").click();

  const linkInput = page.locator("#to_copy");
  await expect(linkInput).toHaveValue(
    /\/html\/messageview\.html\?id=.*#key=.*&iv=.*/
  );

  const messageLink = await linkInput.inputValue();
  await page.goto(messageLink, { waitUntil: "domcontentloaded" });

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
    await replyViewPage.goto(replyLink, { waitUntil: "domcontentloaded" });
    await expect(replyViewPage.locator("#message")).toHaveText(
      "reply from message view"
    );
  } finally {
    await replyViewPage.close();
  }

  const secondViewPage = await browser.newPage();
  try {
    await secondViewPage.goto(messageLink, { waitUntil: "domcontentloaded" });
    await expect(secondViewPage.locator("#message")).toHaveText(/not found/i);
  } finally {
    await secondViewPage.close();
  }
});

test("@e2e creates, opens, decrypts, and renders message images", async ({
  page,
  browser,
}) => {
  const messageText = "secret images from playwright";

  await page.goto("/html/messageadd.html", { waitUntil: "domcontentloaded" });
  await page.locator("#text").fill(messageText);
  await page.setInputFiles("#file-input", [
    {
      name: "secret-one.png",
      mimeType: "image/png",
      buffer: tinyPng,
    },
    {
      name: "secret-two.png",
      mimeType: "image/png",
      buffer: tinyPng,
    },
    {
      name: "secret-three.png",
      mimeType: "image/png",
      buffer: tinyPng,
    },
  ]);

  await expect(page.locator("#preview .upload__img")).toHaveCount(3);

  await page.locator("#generate_button").click();

  const linkInput = page.locator("#to_copy");
  await expect(linkInput).toHaveValue(
    /\/html\/messageview\.html\?id=.*#key=.*&iv=.*/
  );

  const messageLink = await linkInput.inputValue();
  await page.goto(messageLink, { waitUntil: "domcontentloaded" });

  await expect(page.locator("#message")).toHaveText(messageText);
  await expect(page.locator("#images img")).toHaveCount(3);

  for (const image of await page.locator("#images img").all()) {
    await expect(image).toHaveJSProperty("naturalWidth", 1);
    await expect(image).toHaveJSProperty("naturalHeight", 1);
  }

  const secondViewPage = await browser.newPage();
  try {
    await secondViewPage.goto(messageLink, { waitUntil: "domcontentloaded" });
    await expect(secondViewPage.locator("#message")).toHaveText(/not found/i);
  } finally {
    await secondViewPage.close();
  }
});
