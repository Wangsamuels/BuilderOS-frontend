import { defineConfig, devices } from "@playwright/test";

const APP = "http://localhost:3100";
export const API = "http://localhost:4010";

/**
 * End-to-end tests run the production build against tests/mock-api (the API contract with a simulated chain)
 * and a throwaway in-browser wallet. Nothing touches testnet.
 */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: APP,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // uses the Chrome already on this machine; `npx playwright install chromium` and remove `channel` to use the bundled one
    channel: "chrome",
    // one still frame of the WebGL scene instead of a software-rendered animation: keeps CI machines without a GPU fast
    reducedMotion: "reduce",
    launchOptions: { args: ["--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] },
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], channel: "chrome", viewport: { width: 1360, height: 860 } }, testIgnore: /mobile\.spec/ },
    { name: "mobile", use: { ...devices["Pixel 7"], channel: "chrome" }, testMatch: /mobile\.spec/ },
  ],
  webServer: [
    { command: "npm run mock-api", url: `${API}/health`, reuseExistingServer: true, timeout: 20_000 },
    { command: "npm run build:e2e && npm run start:e2e", url: APP, reuseExistingServer: true, timeout: 300_000 },
  ],
});
