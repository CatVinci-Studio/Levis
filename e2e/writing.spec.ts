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
        [...document.body.children].filter((el) => /mermaid/.test(el.id || ""))
          .length,
    ),
  ).toBe(0);
});
