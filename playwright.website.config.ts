import { defineConfig, devices } from "@playwright/test";
import base from "./playwright.config";

/**
 * The website's app screenshots (e2e/website/) -
 * `npm run screenshots:website`. A 1440x900 window at 2x, light appearance.
 * See the spec's header for the languages and where the images go.
 */
const viewport = { width: 1440, height: 900 };

export default defineConfig({
  ...base,
  testDir: "./e2e/website",
  testIgnore: [],
  // Each test is one language's whole set, Mermaid and KaTeX included.
  timeout: 180_000,
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport,
        deviceScaleFactor: 2,
        colorScheme: "light",
      },
    },
  ],
});
