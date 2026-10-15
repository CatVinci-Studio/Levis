import { expect, test, type Page } from "@playwright/test";
import { mockInvoke, openApp, pasteMarkdown } from "./helpers";

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

/** Paragraphs enough to scroll several screens. */
function longDoc(extra: { at: number; text: string }[] = []): string {
  const parts: string[] = [];
  for (let i = 0; i < 80; i++) {
    const hit = extra.find((e) => e.at === i);
    if (hit) parts.push(hit.text);
    parts.push(
      `Paragraph ${i}: the quick brown fox jumps over the lazy dog, and then it runs along the riverbank until the evening comes.`,
    );
  }
  return parts.join("\n\n");
}

test("split view: the wheel scrolls the source, and the preview doesn't pull it back", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await pasteMarkdown(page, longDoc());
  await emit(page, "menu-toggle-split-view");
  const source = page.locator(".split-source");
  await expect(source).toBeVisible();
  const box = (await source.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 15; i++) {
    await page.mouse.wheel(0, 100);
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(400);
  const scrolled = await source.evaluate((el) => el.scrollTop);
  expect(scrolled).toBeGreaterThan(1000);
  await page.waitForTimeout(800);
  expect(await source.evaluate((el) => el.scrollTop)).toBe(scrolled);
  const preview = await page
    .locator(".split-preview")
    .evaluate((el) => el.scrollTop);
  expect(preview).toBeGreaterThan(0);
});

test("find shows the match its counter names while typing", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await pasteMarkdown(
    page,
    longDoc([{ at: 70, text: "A zebracorn appears here." }]),
  );
  await page.keyboard.press("ControlOrMeta+Home");
  await emit(page, "menu-find-replace");
  await page.locator(".find-replace-bar input").first().fill("zebracorn");
  const match = page.locator(".find-match-active");
  await expect(match).toHaveCount(1);
  await expect(match).toBeInViewport();
});

test("an outline jump lands the heading below the window bar", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await pasteMarkdown(
    page,
    longDoc([{ at: 60, text: "## The `far` heading" }]),
  );
  await emit(page, "menu-toggle-sidebar");
  await page.locator(".sidebar-tab").nth(1).click();
  // Inline code shows as its text, not with backticks.
  const row = page.locator(".outline-row .tree-label", {
    hasText: "The far heading",
  });
  await row.click();
  const heading = page.locator(".milkdown h2", { hasText: "heading" });
  await expect(heading).toBeInViewport();
  await page.waitForTimeout(100);
  const top = (await heading.boundingBox())!.y;
  expect(top).toBeGreaterThanOrEqual(28);
  expect(top).toBeLessThan(120);
});

test("accepting one of two proposals in a paragraph keeps the other", async ({
  page,
}) => {
  await openApp(page, {
    settings: { language: "en" },
    storage: { "levis-agent-panel-open": "1" },
  });
  await pasteMarkdown(page, "The cat sat on the mat and the dog ran far.");
  await mockInvoke(page, {
    ai_agent_message: [
      { kind: "User", text: "Fix both" },
      {
        kind: "ToolCall",
        call_id: "a1",
        name: "propose_edit",
        arguments: JSON.stringify({
          action: "replace",
          anchor: "cat sat",
          text: "cat slept",
        }),
      },
      { kind: "ToolResult", call_id: "a1", output: "Edit proposed" },
      {
        kind: "ToolCall",
        call_id: "a2",
        name: "propose_edit",
        arguments: JSON.stringify({
          action: "replace",
          anchor: "dog ran",
          text: "dog walked",
        }),
      },
      { kind: "ToolResult", call_id: "a2", output: "Edit proposed" },
      { kind: "Assistant", text: "Done." },
    ],
  });
  const composer = page.locator(".agent-panel-view textarea");
  await composer.fill("Fix both");
  await composer.press("Enter");
  const accept = page.locator(
    ".agent-proposal-actions .inline-chat-action-primary",
  );
  await expect(accept).toHaveCount(2);
  // The second first, then the first: both land.
  await accept.nth(1).click();
  await expect(accept).toHaveCount(1);
  await accept.first().click();
  await expect(accept).toHaveCount(0);
  await expect(page.locator(".milkdown p").first()).toHaveText(
    "The cat slept on the mat and the dog walked far.",
  );
});

test("a broken diagram leaves no mermaid node in the page", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await pasteMarkdown(
    page,
    "```mermaid\ngraph TD\n  A-->B\n```\n\n```mermaid\ngraph TD\n  A-->>>\n```\n\nEnd.",
  );
  await expect(page.locator(".mermaid-preview svg")).toHaveCount(1, {
    timeout: 10_000,
  });
  await page.waitForTimeout(300);
  expect(
    await page.evaluate(
      () =>
        Array.from(document.body.children).filter((el) =>
          /mermaid/.test(el.id || ""),
        ).length,
    ),
  ).toBe(0);
});

test("a diagram is redrawn in the new colours when the appearance switches", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await openApp(page, { settings: { language: "en" } });
  await pasteMarkdown(page, "```mermaid\ngraph TD\n  A-->B\n```\n\nEnd.");
  const svg = page.locator(".mermaid-preview svg");
  await expect(svg).toHaveCount(1, { timeout: 10_000 });
  const firstId = await svg.getAttribute("id");
  await page.emulateMedia({ colorScheme: "dark" });
  // A fresh render, not the light one kept on screen.
  await expect
    .poll(async () => svg.getAttribute("id"), { timeout: 10_000 })
    .not.toBe(firstId);
  await expect(svg).toHaveCount(1);
});

test("the outline marks the section being read", async ({ page }) => {
  await openApp(page, { settings: { language: "en" } });
  await pasteMarkdown(
    page,
    longDoc([
      { at: 10, text: "## Early section" },
      { at: 60, text: "## Late section" },
    ]),
  );
  await emit(page, "menu-toggle-sidebar");
  await page.locator(".sidebar-tab").nth(1).click();
  await page
    .locator(".outline-row .tree-label", { hasText: "Late section" })
    .click();
  const current = page.locator('.outline-row [aria-current="location"]');
  await expect(current).toHaveText("Late section");
  await page
    .locator(".outline-row .tree-label", { hasText: "Early section" })
    .click();
  await expect(current).toHaveText("Early section");
});

test("an empty document doesn't scroll", async ({ page }) => {
  await openApp(page, { settings: { language: "en" } });
  const scroller = page.locator('[data-active-tab="true"] .editor-scroll');
  expect(
    await scroller.evaluate((el) => el.scrollHeight - el.clientHeight),
  ).toBeLessThanOrEqual(0);
});

test("zooming keeps the line being read in place", async ({ page }) => {
  await openApp(page, {
    // Full width: the column can't widen with the zoom, so the text
    // rewraps and the content doesn't grow in proportion.
    settings: { language: "en", contentWidth: "full" },
  });
  await pasteMarkdown(page, longDoc([{ at: 50, text: "## Anchor line" }]));
  const heading = page.locator(".milkdown h2", { hasText: "Anchor line" });
  await heading.evaluate((el) =>
    el.scrollIntoView({ block: "center", behavior: "instant" }),
  );
  const before = (await heading.boundingBox())!;
  const center = await page.evaluate(() => {
    const box = document
      .querySelector('[data-active-tab="true"] .editor-scroll')!
      .getBoundingClientRect();
    return box.top + box.height / 2;
  });
  await emit(page, "menu-zoom-in");
  await emit(page, "menu-zoom-in");
  await page.waitForTimeout(200);
  const after = (await heading.boundingBox())!;
  // The heading at the pane's centre stays there.
  console.log(
    "zoom",
    before.y + before.height / 2,
    after.y + after.height / 2,
    center,
  );
  expect(
    Math.abs(after.y + after.height / 2 - (before.y + before.height / 2)),
  ).toBeLessThan(24);
});

test("the math preview follows its formula when the column moves", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await pasteMarkdown(page, "Some text with $x^2 + y^2$ in it.");
  // Into the formula from the end of the line.
  await page.locator('[data-active-tab="true"] .milkdown p').first().click();
  await page.keyboard.press("End");
  for (let i = 0; i < 9; i++) await page.keyboard.press("ArrowLeft");
  const preview = page.locator(".math-float-preview");
  await expect(preview).toBeVisible();
  const before = (await preview.boundingBox())!;
  // The AI panel takes its room; the column (and the formula) moves left.
  await emit(page, "menu-toggle-agent-panel");
  await expect(page.locator(".agent-panel")).toBeVisible();
  await expect
    .poll(async () => (await preview.boundingBox())!.x)
    .not.toBe(before.x);
});

test("a note's body starts flush with the lines under it", async ({ page }) => {
  await openApp(page, { settings: { language: "en" } });
  await pasteMarkdown(
    page,
    "Intro.\n\n> [!NOTE]\n> Useful information.\n\nEnd.",
  );
  await page.locator('[data-active-tab="true"] .milkdown p').last().click();
  // The marker line's soft break is hidden with the marker: drawn, it was
  // a space at the start of the body.
  const shown = await page.evaluate(() =>
    Array.from(
      document.querySelectorAll(
        '[data-active-tab="true"] blockquote.md-alert [data-type="hardbreak"]',
      ),
    ).map((el) => getComputedStyle(el).display),
  );
  expect(shown).toEqual(["none"]);
});

test("typed dollar amounts stay text; a typed formula still forms", async ({
  page,
}) => {
  await openApp(page, { settings: { language: "en" } });
  await page.locator('[data-active-tab="true"] .ProseMirror').click();
  await page.keyboard.type("It costs $5 a month, or $50 a year.", {
    delay: 20,
  });
  await page.keyboard.press("Enter");
  await page.keyboard.type("Price $4) and $19 ok.", { delay: 20 });
  await page.keyboard.press("Enter");
  await page.keyboard.type("The plan costs $5.", { delay: 20 });
  await page.keyboard.press("Enter");
  await page.keyboard.type("Area $x^2$ and $2 \\times 3$ here.", {
    delay: 20,
  });
  const paragraphs = page.locator('[data-active-tab="true"] .ProseMirror p');
  await expect(paragraphs).toHaveCount(4);
  const prices = [
    "It costs $5 a month, or $50 a year.",
    "Price $4) and $19 ok.",
    "The plan costs $5.",
  ];
  for (let i = 0; i < prices.length; i++) {
    await expect(paragraphs.nth(i)).toHaveText(prices[i]);
    await expect(paragraphs.nth(i).locator(".math-inline")).toHaveCount(0);
  }
  await expect(paragraphs.nth(3).locator(".math-inline")).toHaveCount(2);
});
