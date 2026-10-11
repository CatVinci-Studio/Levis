import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

/** The README screenshots (e2e/readme/) - `npm run screenshots:readme`. */
export default defineConfig({
  ...base,
  testDir: "./e2e/readme",
  testIgnore: [],
});
