import { expect, test, type Page } from "@playwright/test";
import { mockInvoke, openApp, pasteMarkdown } from "./helpers";

// Issues #59 and #60: what a paste puts in the markdown. The backend is the
// dev shim, so the image commands answer with canned srcs - the Rust side
// of storing the file is covered by its own tests.

function emit(page: Page, name: string) {
  return page.evaluate(
    (n) =>
      (
        window as unknown as { __devEmitTauriEvent: (name: string) => void }
      ).__devEmitTauriEvent(n),
    name,
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
  return value.trim();
}

/** Dispatches a paste carrying exactly these clipboard flavors. */
async function paste(page: Page, flavors: Record<string, string>) {
  await page.evaluate((data) => {
    const target = document.querySelector<HTMLElement>(
      '[data-active-tab="true"] .ProseMirror',
    )!;
    target.focus();
    const transfer = new DataTransfer();
    for (const [type, value] of Object.entries(data))
      transfer.setData(type, value);
    target.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: transfer,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, flavors);
  await page.waitForTimeout(300);
}

// A 1x1 PNG.
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const editor = '[data-active-tab="true"] .ProseMirror';

test.beforeEach(async ({ page }) => {
  await openApp(page, { settings: { language: "en" } });
  await page.locator(editor).click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Backspace");
});

test("a pasted URL becomes a link with the URL as its text", async ({
  page,
}) => {
  const url = "https://github.com/CatVinci-Studio/Textus/issues";
  await paste(page, { "text/plain": url });
  await expect(page.locator(`${editor} a[href="${url}"]`)).toHaveText(url);
  expect(await sourceOf(page)).toBe(`[${url}](${url})`);
});

test("an empty-text link shows its URL and is saved as written", async ({
  page,
}) => {
  await pasteMarkdown(page, "See [](https://x.org/a) and <https://x.org/b>");
  await expect(page.locator(`${editor} a[href="https://x.org/a"]`)).toHaveText(
    "https://x.org/a",
  );
  expect(await sourceOf(page)).toBe(
    "See [](https://x.org/a) and <https://x.org/b>",
  );
});

test("a screenshot pasted as a blob: image is stored in assets/", async ({
  page,
}) => {
  await mockInvoke(page, { save_pasted_image: { src: "assets/shot.png" } });
  // What WebKitGTK hands the page for a bitmap on the clipboard.
  const blobUrl = await page.evaluate((b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    return URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
  }, PNG);
  await paste(page, { "text/html": `<img src="${blobUrl}">` });
  await expect(page.locator(`${editor} .image-view img`)).toHaveCount(1);
  await expect.poll(() => sourceOf(page)).toBe("![](assets/shot.png)");
});

test("an image file copied in the file manager is pasted as an image", async ({
  page,
}) => {
  await mockInvoke(page, {
    read_binary_file_base64: PNG,
    save_pasted_image: { src: "assets/copied.png" },
  });
  await paste(page, {
    "text/uri-list": "file:///home/me/%E5%9B%BE/shot.png",
    "text/plain": "/home/me/图/shot.png",
  });
  expect(await sourceOf(page)).toBe("![](assets/copied.png)");
});

test("a file:// link to an image, as WebKitGTK renders a copied file", async ({
  page,
}) => {
  await mockInvoke(page, {
    read_binary_file_base64: PNG,
    save_pasted_image: { src: "assets/linked.png" },
  });
  await paste(page, {
    "text/html": '<a href="file:///home/me/shot.png">/home/me/shot.png</a>',
    "text/plain": "/home/me/shot.png",
  });
  expect(await sourceOf(page)).toBe("![](assets/linked.png)");
});

test("a copied non-image file still pastes as a link", async ({ page }) => {
  await paste(page, {
    "text/html": '<a href="file:///home/me/a.pdf">/home/me/a.pdf</a>',
    "text/plain": "/home/me/a.pdf",
  });
  expect(await sourceOf(page)).toBe("[/home/me/a.pdf](file:///home/me/a.pdf)");
});
