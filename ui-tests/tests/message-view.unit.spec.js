const { test, expect } = require("@playwright/test");

function arrayBufferToBase64(buf) {
  return Buffer.from(new Uint8Array(buf)).toString("base64");
}

const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64"
);

async function encryptFixture(text, imageBytes) {
  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 128 },
    true,
    ["encrypt", "decrypt"]
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const exportKey = await crypto.subtle.exportKey("raw", key);

  const textCipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(text)
  );
  const imageCipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    imageBytes
  );

  return {
    key: arrayBufferToBase64(exportKey),
    iv: arrayBufferToBase64(iv),
    textCipherBase64: arrayBufferToBase64(textCipher),
    imageCipherBytes: Buffer.from(new Uint8Array(imageCipher)),
  };
}

test("@unit decrypts encrypted message and image from the view API while showing the image loader", async ({
  page,
}) => {
  const plainText = "plain text that must not arrive from the API";
  const plainImage = tinyPng;
  const imageID = "6a938b32-e701-4807-b099-ddfbd19ecd22";
  const encrypted = await encryptFixture(plainText, plainImage);

  expect(encrypted.textCipherBase64).not.toContain(plainText);
  expect(encrypted.imageCipherBytes.equals(plainImage)).toBeFalsy();
  expect(encrypted.imageCipherBytes.includes(Buffer.from("PNG"))).toBeFalsy();

  let fulfillImage;
  const imageResponseReady = new Promise((resolve) => {
    fulfillImage = resolve;
  });

  await page.route("**/api/v1/message/view?id=unit-message", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        code: 200,
        body: {
          text: encrypted.textCipherBase64,
          imgs: [imageID],
        },
      }),
    });
  });

  await page.route("**/api/v1/image/view", async (route) => {
    await imageResponseReady;

    await route.fulfill({
      contentType: "application/octet-stream",
      body: encrypted.imageCipherBytes,
    });
  });

  const viewURL =
    "/html/messageview.html?id=unit-message#key=" +
    encodeURIComponent(encrypted.key) +
    "&iv=" +
    encodeURIComponent(encrypted.iv);

  await page.goto(viewURL);

  await expect(page.locator("#message")).toHaveText(plainText);
  await expect(page.locator("#images .result__image-loader")).toHaveCount(1);

  fulfillImage();

  await expect(page.locator("#images img")).toHaveCount(1);
  const loadedImageURL = await page.locator("#images img").getAttribute("src");
  expect(loadedImageURL).toMatch(/^blob:/);

  const loadedImageBytes = await page.evaluate(async (url) => {
    const resp = await fetch(url);
    const buf = await resp.arrayBuffer();
    return {
      contentType: resp.headers.get("content-type"),
      bytes: Array.from(new Uint8Array(buf)),
    };
  }, loadedImageURL);

  expect(loadedImageBytes.contentType).toBe("image/png");
  expect(Buffer.from(loadedImageBytes.bytes).equals(plainImage)).toBeTruthy();
  await expect(page.locator("#images .result__image-loader")).toHaveCount(0);
});
