import { devices, expect, test, type Page } from "@playwright/test";
import { openApp, pasteMarkdown } from "./helpers";

// The iPhone layout (ui/mobile.css), checked in Chromium with touch and a
// phone-sized viewport: Playwright can't drive iOS WebKit itself, and the
// layout is keyed off the platform, which is faked as an iPhone here.
test.use({
  viewport: { width: 430, height: 932 },
  isMobile: true,
  hasTouch: true,
  userAgent: devices["iPhone 15 Pro Max"].userAgent,
});

async function openPhone(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "platform", { get: () => "iPhone" });
  });
  await openApp(page, { settings: { language: "en" } });
  await expect(page.locator("html")).toHaveAttribute(
    "data-window-chrome",
    "mobile",
  );
}

test("the phone menu opens the sidebar as a drawer over the page", async ({
  page,
}) => {
  await openPhone(page);
  await page.locator(".window-menu-button").tap();
  const items = page.getByRole("menuitem");
  // A flat list - no File/Edit/View flyouts on a phone.
  await expect(items.first()).toHaveText("New File");
  await expect(page.getByRole("menuitem", { name: "Open Recent" })).toHaveCount(
    0,
  );
  await page.getByRole("menuitem", { name: "Toggle Sidebar" }).tap();

  const sidebar = page.locator(".sidebar");
  await expect(sidebar).not.toHaveClass(/sidebar-collapsed/);
  // Over the editor, not beside it: the page keeps the full width.
  const pane = await page.locator(".main-pane").boundingBox();
  expect(pane?.x).toBe(0);
  expect(pane?.width).toBe(430);

  // A tap beside the drawer closes it.
  await page.locator(".sidebar-scrim").tap({ position: { x: 400, y: 500 } });
  await expect(sidebar).toHaveClass(/sidebar-collapsed/);
});

test("Levis AI fills the screen and keeps the title row", async ({ page }) => {
  await openPhone(page);
  await page.locator(".window-bar-toggle").tap();
  const panel = await page.locator(".agent-panel").boundingBox();
  expect(panel).toMatchObject({ x: 0, width: 430 });
  // The toggle that closes it stays reachable above it.
  await page.locator(".window-bar-toggle").tap();
  await expect(page.locator(".agent-panel")).toHaveCount(0);
});

test("a tap on the suggestion accepts it", async ({ page }) => {
  await openPhone(page);
  await pasteMarkdown(page, "The plan");
  await page.locator(".milkdown p").first().click();
  await page.keyboard.press("End");
  await page.keyboard.type(" works");
  const ghost = page.locator(".ghost-text");
  await expect(ghost).toHaveAttribute(
    "data-suggestion",
    " and this ghost text is a canned dev-shim suggestion.",
  );
  await ghost.tap();
  await expect(page.locator(".milkdown p").first()).toHaveText(
    "The plan works and this ghost text is a canned dev-shim suggestion.",
  );
});
