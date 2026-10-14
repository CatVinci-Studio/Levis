import { expect, test, type Page } from "@playwright/test";
import { PHONE, openPhone } from "./helpers";

// Settings on an iPhone (settings/PhoneSettings.tsx): a full-screen page
// laid out like the Settings app, checked in Chromium with touch and a
// phone-sized viewport (see PHONE and openPhone in helpers.ts).
test.use(PHONE);

async function openSettings(page: Page) {
  await page.locator(".window-menu-button").tap();
  await page.getByRole("menuitem", { name: "Settings…" }).tap();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await expect(settings).toBeVisible();
  return settings;
}

test("settings fill the screen, over the title row", async ({ page }) => {
  await openPhone(page);
  const settings = await openSettings(page);
  expect(await settings.boundingBox()).toEqual({
    x: 0,
    y: 0,
    width: 430,
    height: 932,
  });
  // Its own bar, not the app's: the title row is covered.
  await expect(
    settings.getByRole("heading", { name: "Settings" }),
  ).toBeVisible();
  const menu = page.locator(".window-menu-button");
  expect(
    await menu.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(
        r.x + r.width / 2,
        r.y + r.height / 2,
      );
      return el.contains(top);
    }),
  ).toBe(false);
});

test("the root list pushes a category and Back returns", async ({ page }) => {
  await openPhone(page);
  const settings = await openSettings(page);
  // One row per category, a finger's height.
  for (const name of [
    "General",
    "Editor & Appearance",
    "AI Services",
    "Agent",
    "Privacy",
  ]) {
    const row = settings.getByRole("button", { name, exact: true });
    await expect(row).toBeVisible();
    expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  await expect(settings.getByRole("button", { name: "Shortcuts" })).toHaveCount(
    0,
  );

  await settings.getByRole("button", { name: "Editor & Appearance" }).tap();
  await expect(
    settings.getByRole("heading", { name: "Editor & Appearance" }),
  ).toBeVisible();
  await expect(
    settings.getByRole("region", { name: "Editor & Appearance" }),
  ).toBeVisible();
  // iOS-sized switches.
  const toggle = settings.locator('input[type="checkbox"]').first();
  expect(await toggle.boundingBox()).toMatchObject({ width: 51, height: 31 });

  await settings.getByRole("button", { name: "Settings" }).tap();
  await expect(
    settings.getByRole("heading", { name: "Settings" }),
  ).toBeVisible();
  await expect(settings.getByRole("button", { name: "General" })).toBeVisible();
});

test("a setting changed on its page sticks", async ({ page }) => {
  await openPhone(page);
  const settings = await openSettings(page);
  await settings.getByRole("button", { name: "Editor & Appearance" }).tap();
  const typewriter = settings.getByRole("checkbox", { name: /Typewriter/ });
  await expect(typewriter).not.toBeChecked();
  await typewriter.tap();
  await expect(typewriter).toBeChecked();
});

test("the provider list is a page of its own", async ({ page }) => {
  await openPhone(page);
  const settings = await openSettings(page);
  await settings.getByRole("button", { name: "AI Services" }).tap();
  await settings.getByRole("button", { name: /^Provider:/ }).tap();
  const list = page.locator(".combobox-page");
  expect(await list.boundingBox()).toEqual({
    x: 0,
    y: 0,
    width: 430,
    height: 932,
  });
  // No keyboard springing up over the list.
  await expect(list.getByRole("textbox")).not.toBeFocused();
  await list.getByRole("button", { name: "AI Services" }).tap();
  await expect(list).toHaveCount(0);
  await expect(
    settings.getByRole("heading", { name: "AI Services" }),
  ).toBeVisible();
});

test("Done closes settings from any page", async ({ page }) => {
  await openPhone(page);
  let settings = await openSettings(page);
  await settings.getByRole("button", { name: "Done" }).tap();
  await expect(settings).toHaveCount(0);

  settings = await openSettings(page);
  await settings.getByRole("button", { name: "Privacy" }).tap();
  await settings.getByRole("button", { name: "Done" }).tap();
  await expect(settings).toHaveCount(0);
});
