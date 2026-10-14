import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./helpers";

function emit(page: Page, name: string, payload?: unknown) {
  return page.evaluate(
    ([n, p]) =>
      (
        window as unknown as {
          __devEmitTauriEvent: (name: string, payload?: unknown) => void;
        }
      ).__devEmitTauriEvent(n as string, p),
    [name, payload] as const,
  );
}

/** The active document's Markdown, read from source mode (and back). */
async function sourceOf(page: Page): Promise<string> {
  await emit(page, "menu-toggle-source-mode");
  const textarea = page.locator(
    '[data-active-tab="true"] textarea.source-view',
  );
  await expect(textarea).toBeAttached();
  const value = await textarea.inputValue();
  await emit(page, "menu-toggle-source-mode");
  await expect(textarea).toHaveCount(0);
  return value;
}

test("typing a closing ** or ~~ by hand closes the span once", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await page.locator('[data-active-tab="true"] .ProseMirror').click();
  await page.keyboard.type("A **bold** and *it* end. ~~s~~ done", {
    delay: 30,
  });
  expect((await sourceOf(page)).trim()).toBe(
    "A **bold** and *it* end. ~~s~~ done",
  );
});
