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
  // A flat list - no File/Edit/View flyouts on a phone - led by Documents.
  await expect(page.getByRole("menuitem").first()).toHaveText("Documents");
  const sidebarItem = page.getByRole("menuitemcheckbox", { name: "Sidebar" });
  await expect(sidebarItem).toHaveAttribute("aria-checked", "false");
  await sidebarItem.tap();

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

test("view modes in the phone menu show whether they are on", async ({
  page,
}) => {
  await openPhone(page);
  await page.locator(".window-menu-button").tap();
  const typewriter = page.getByRole("menuitemcheckbox", {
    name: "Typewriter Mode",
  });
  await expect(typewriter).toHaveAttribute("aria-checked", "false");
  await expect(typewriter.locator(".app-menu-check")).toHaveCount(0);
  await typewriter.tap();
  await page.locator(".window-menu-button").tap();
  await expect(typewriter).toHaveAttribute("aria-checked", "true");
  await expect(typewriter.locator(".app-menu-check")).toHaveCount(1);
});

test("Levis AI is a bottom sheet that leaves the document in view", async ({
  page,
}) => {
  await openPhone(page);
  await page.locator(".window-bar-toggle").tap();
  const half = await page.locator(".agent-panel").boundingBox();
  expect(half).toMatchObject({ x: 0, width: 430 });
  // Docked to the bottom, about half the screen.
  expect(Math.round(half!.y + half!.height)).toBe(932);
  expect(half!.height).toBeLessThan(932 * 0.6);

  // The handle pulls it up to full height and back.
  await page.locator(".agent-panel-grip").tap();
  await expect
    .poll(
      async () => (await page.locator(".agent-panel").boundingBox())!.height,
    )
    .toBeGreaterThan(932 * 0.9);
  await page.locator(".agent-panel-grip").tap();
  await expect
    .poll(
      async () => (await page.locator(".agent-panel").boundingBox())!.height,
    )
    .toBeLessThan(932 * 0.6);

  // The title row's toggle still closes it.
  await page.locator(".window-bar-toggle").tap();
  await expect(page.locator(".agent-panel")).toHaveCount(0);
});

test("Documents opens as its own page and closes again", async ({ page }) => {
  await openPhone(page);
  await page.locator(".window-menu-button").tap();
  await page.getByRole("menuitem", { name: "Documents" }).tap();
  const list = page.getByRole("dialog", { name: "Documents" });
  await expect(list).toBeVisible();
  await list.getByRole("button", { name: "Close" }).tap();
  await expect(list).toHaveCount(0);
});

test("the keyboard toolbar formats without leaving the document", async ({
  page,
}) => {
  await openPhone(page);
  await pasteMarkdown(page, "plain words");
  const toolbar = page.getByRole("toolbar", { name: "Formatting" });
  const para = page.locator('[data-active-tab="true"] .milkdown p').first();
  await para.click();
  await expect(toolbar).toBeVisible();
  // A selection inside the paragraph, as the iPhone's handles make one.
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End");
  await toolbar.getByRole("button", { name: "Bold" }).tap();
  await expect(para.locator("strong")).toHaveText("plain words");
  // A second tap makes it plain again; italic works the same way.
  await toolbar.getByRole("button", { name: "Bold" }).tap();
  await expect(para.locator("strong")).toHaveCount(0);
  await toolbar.getByRole("button", { name: "Italic" }).tap();
  await expect(para.locator("em")).toHaveText("plain words");
  // Still editing: the toolbar didn't take the focus.
  await expect(toolbar).toBeVisible();
});

test("phone settings have no Shortcuts page", async ({ page }) => {
  await openPhone(page);
  await page.locator(".window-menu-button").tap();
  await page.getByRole("menuitem", { name: "Settings…" }).tap();
  await expect(page.getByRole("button", { name: "General" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Shortcuts" })).toHaveCount(0);
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
