const { defineConfig, devices } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  workers: 2,
  expect: {
    timeout: 5_000,
  },
  use: {
    baseURL: process.env.UI_TEST_BASE_URL || "https://127.0.0.1",
    ignoreHTTPSErrors: true,
    serviceWorkers: "block",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },
  ],
});
