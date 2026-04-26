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
