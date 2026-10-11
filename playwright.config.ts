import { defineConfig, devices } from "@playwright/test";

/**
 * Visual tests: the frontend in Chromium against the Vite dev server, with
 * the dev Tauri shim standing in for the backend (src/dev-tauri-shim.ts).
 * Screenshot baselines are per platform (Playwright adds the OS to the file
 * name) - regenerate with `npm run test:visual -- --update-snapshots` after
 * an intended UI change, and review the diff images in test-results/.
 *
 * Native behaviour (windows, dialogs, single instance) isn't reachable from
 * here - scripts/smoke-linux.sh covers the built app.
 */
export default defineConfig({
  testDir: "./e2e",
  // The README screenshots run on their own (playwright.readme.config.ts).
  testIgnore: "readme/**",
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  expect: {
    // A tight per-pixel threshold: the default (0.2) reads a light panel tint
    // such as the code-block background as plain white.
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.01,
      threshold: 0.05,
      animations: "disabled",
    },
  },
  use: {
    baseURL: "http://localhost:1430",
    viewport: { width: 1180, height: 780 },
    deviceScaleFactor: 1,
    locale: "zh-CN",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1180, height: 780 },
      },
    },
  ],
  webServer: {
    command: "npx vite --port 1430 --strictPort",
    url: "http://localhost:1430",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
