const { test, expect } = require("@playwright/test");

const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64"
);

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

test("@unit updates the message textarea counter and enforces the client limit", async ({
  page,
}) => {
  await page.goto("/html/messageadd.html");

  await expect(page.locator(".js__counter-max")).toHaveText("1024");

  await page.locator("#text").fill("hello");
  await expect(page.locator(".js__counter")).toHaveText("5");

  await page.locator("#text").evaluate((textarea) => {
    textarea.value = "x".repeat(1025);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });

  await expect(page.locator("#text")).toHaveValue("x".repeat(1024));
  await expect(page.locator(".js__counter")).toHaveText("1024");
  await expect(page.locator(".text__symbols")).toHaveCSS(
    "color",
    "rgb(255, 0, 0)"
  );
});

test("@unit renders the generated link and copies it from a mocked API response", async ({
  page,
}) => {
  await page.route("**/api/v1/message/add", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        code: 200,
        body: {
          link: "https://127.0.0.1/html/messageview.html?id=unit-message",
        },
      }),
    });
  });

  await page.goto("/html/messageadd.html");
  await page.locator("#text").fill("line one\nline two");
  await page.locator("#generate_button").click();

  await expect(page.locator("#message_box")).toBeVisible();
  await expect(page.locator("#result_text")).toContainText("line one");
  await expect(page.locator("#result_text")).toContainText("line two");
  await expect(page.locator("#to_copy")).toHaveValue(/unit-message#key=/);
  await expect(page.locator("#to_copy")).toHaveValue(/&iv=/);

  const linkToCopy = await page.locator("#to_copy").inputValue();
  const linkURL = new URL(linkToCopy);
  const linkHash = new URLSearchParams(linkURL.hash.slice(1));

  expect(linkURL.origin).toBe("https://127.0.0.1");
  expect(linkURL.pathname).toBe("/html/messageview.html");
  expect(linkURL.searchParams.get("id")).toBe("unit-message");
  expect(linkHash.get("key")).toBeTruthy();
  expect(linkHash.get("iv")).toBeTruthy();

  await page.locator("#copy_button").click();

  const copiedText = await page.evaluate(() => window.__copiedText);
  expect(copiedText).toBe(linkToCopy);
  await expect(page.locator("#copy_button")).toHaveText("Copied!");
});

test("@unit resets the copy button when a new message link is generated", async ({
  page,
}) => {
  let responseIndex = 0;
  const messageIDs = ["first-message", "second-message"];

  await page.route("**/api/v1/message/add", async (route) => {
    const messageID = messageIDs[responseIndex];
    responseIndex += 1;

    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        code: 200,
        body: {
          link: `https://127.0.0.1/html/messageview.html?id=${messageID}`,
        },
      }),
    });
  });

  await page.goto("/html/messageadd.html");
  await page.locator("#text").fill("first message");
  await page.locator("#generate_button").click();

  await expect(page.locator("#to_copy")).toHaveValue(/first-message#key=/);
  await page.locator("#copy_button").click();
  await expect(page.locator("#copy_button")).toHaveText("Copied!");

  await page.locator("#text").fill("second message");
  await page.locator("#generate_button").click();

  await expect(page.locator("#to_copy")).toHaveValue(/second-message#key=/);
  await expect(page.locator("#copy_button")).toHaveText("Copy link");
});

test("@unit renders API validation errors without clearing the original text", async ({
  page,
}) => {
  await page.route("**/api/v1/message/add", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        code: 400,
        body: "maximum text length of 2048 is allowed",
      }),
    });
  });

  await page.goto("/html/messageadd.html");
  await page.locator("#text").fill("please keep this draft");
  await page.locator("#generate_button").click();

  await expect(page.locator("#message_box")).toBeVisible();
  await expect(page.locator("#result_link")).toHaveText(
    "error: maximum text length of 2048 is allowed"
  );
  await expect(page.locator("#text")).toHaveValue("please keep this draft");
});

test("@unit uploads multiple queued images and attaches all returned ids to the message", async ({
  page,
}) => {
  const imageIds = [
    "6a938b32-e701-4807-b099-ddfbd19ecd22",
    "46f46909-4871-4a98-b3a7-be605032efe5",
  ];
  let imageUploadCount = 0;

  await page.route("**/api/v1/image/add", async (route) => {
    const id = imageIds[imageUploadCount];
    imageUploadCount++;

    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        code: 200,
        body: { id },
      }),
    });
  });

  await page.route("**/api/v1/message/add", async (route) => {
    const body = route.request().postData();
    expect(body).toContain(imageIds.join(","));

    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        code: 200,
        body: {
          link: "https://127.0.0.1/html/messageview.html?id=unit-message",
        },
      }),
    });
  });

  await page.goto("/html/messageadd.html");
  await page.setInputFiles("#file-input", [
    {
      name: "first.png",
      mimeType: "image/png",
      buffer: tinyPng,
    },
    {
      name: "second.png",
      mimeType: "image/png",
      buffer: tinyPng,
    },
  ]);

  await expect(page.locator("#preview .upload__img")).toHaveCount(2);

  await page.locator("#text").fill("secret with images");
  await page.locator("#generate_button").click();

  await expect(page.locator("#to_copy")).toHaveValue(/unit-message#key=/);
  expect(imageUploadCount).toBe(2);
});

test("@unit removes an image from the upload queue before submit", async ({
  page,
}) => {
  let imageUploadCount = 0;

  await page.route("**/api/v1/image/add", async (route) => {
    imageUploadCount++;

    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        code: 200,
        body: { id: "6a938b32-e701-4807-b099-ddfbd19ecd22" },
      }),
    });
  });

  await page.route("**/api/v1/message/add", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        code: 200,
        body: {
          link: "https://127.0.0.1/html/messageview.html?id=unit-message",
        },
      }),
    });
  });

  await page.goto("/html/messageadd.html");
  await page.setInputFiles("#file-input", [
    {
      name: "keep.png",
      mimeType: "image/png",
      buffer: tinyPng,
    },
    {
      name: "remove.png",
      mimeType: "image/png",
      buffer: tinyPng,
    },
  ]);

  await expect(page.locator("#preview .upload__img")).toHaveCount(2);

  await page.locator("#preview .upload__delete").nth(1).click();
  await expect(page.locator("#preview .upload__img")).toHaveCount(1);

  await page.locator("#text").fill("secret with one image");
  await page.locator("#generate_button").click();

  await expect(page.locator("#to_copy")).toHaveValue(/unit-message#key=/);
  expect(imageUploadCount).toBe(1);
});

test("@unit allows selecting the same image again after removing it from the queue", async ({
  page,
}) => {
  await page.goto("/html/messageadd.html");

  await page.setInputFiles("#file-input", {
    name: "same-image.png",
    mimeType: "image/png",
    buffer: tinyPng,
  });
  await expect(page.locator("#preview .upload__img")).toHaveCount(1);

  await page.locator("#preview .upload__delete").click();
  await expect(page.locator("#preview .upload__img")).toHaveCount(0);

  await page.setInputFiles("#file-input", {
    name: "same-image.png",
    mimeType: "image/png",
    buffer: tinyPng,
  });
  await expect(page.locator("#preview .upload__img")).toHaveCount(1);
});
