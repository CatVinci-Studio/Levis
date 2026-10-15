import { expect, test, type Page } from "@playwright/test";
import { mockInvoke, openApp, openPhone, PHONE } from "./helpers";

// Screenshots of the AI surfaces in the text - a rewrite decided sentence by
// sentence, the review bar, margin notes, the grammar card, the Memory view
// - on desktop and phone, light and dark, for review rather than as a
// baseline. The sample is a reader's own notes on a classic: the AI edits
// the notes, and the quoted original is never touched. Runs only with
// LEVIS_SHOTS_DIR set to where the PNGs go:
//
//   LEVIS_SHOTS_DIR=../assets/working/ai-design/shots npx playwright test ai-design-shots

const DIR = process.env.LEVIS_SHOTS_DIR;
test.skip(!DIR, "set LEVIS_SHOTS_DIR to take the screenshots");

const QUOTE =
  "宝玉看罢，因笑道：“这个妹妹我曾见过的。”贾母笑道：“可又是胡说，你又何曾见过他？”";
const NOTE =
  "这一句其实是在呼应第一回的前世姻缘，可以说是全书爱情线的一个起点。宝玉初见黛玉便觉似曾相识，作者就某种意义而言是借这句话点明了木石前盟。贾母一句“胡说”，却把这层深意轻轻带过。";
const REWRITE =
  "这一句呼应第一回的前世姻缘，是全书爱情线的起点。宝玉初见黛玉便觉似曾相识，作者借这句话点明了木石前盟。贾母一句“胡说”，却把这层深意轻轻带过。";
const DOC = `# 读《红楼梦》第三回

> ${QUOTE}

## 我的笔记

${NOTE}

黛玉必竟寄人篱下，所以步步留心，时时在意，这份小心在初见宝玉时也没有放下。

下一回读到“护官符”，再回来补这一段。
`;

const REPLY = [
  { kind: "User", text: "把我的笔记改得精简一些，再帮我看看哪里还能写深。" },
  {
    kind: "ToolCall",
    call_id: "e1",
    name: "propose_edit",
    arguments: JSON.stringify({
      action: "replace",
      anchor: NOTE,
      text: REWRITE,
      reason: "删去“其实”“可以说”“就某种意义而言”，意思不变。",
    }),
  },
  { kind: "ToolResult", call_id: "e1", output: "Edit proposed" },
  {
    kind: "ToolCall",
    call_id: "c1",
    name: "add_comment",
    arguments: JSON.stringify({
      anchor: "贾母一句“胡说”，却把这层深意轻轻带过。",
      comment: "可以补一句贾母为何要打断：她护着黛玉，也护着宝玉。",
    }),
  },
  { kind: "ToolResult", call_id: "c1", output: "Comment added" },
  {
    kind: "Assistant",
    text: "精简了你笔记里的两句，并在“胡说”那句旁留了一条批注。",
  },
];

async function paste(page: Page) {
  await page.evaluate((md) => {
    const target = document.querySelector<HTMLElement>(
      '[data-active-tab="true"] .ProseMirror',
    )!;
    target.focus();
    const data = new DataTransfer();
    data.setData("text/plain", md);
    target.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, DOC);
  await page.waitForTimeout(300);
}

/** The checker's finding in the notes, without a backend (the tutorial's
 *  canned-issue event). */
async function grammar(page: Page) {
  const target =
    "黛玉必竟寄人篱下，所以步步留心，时时在意，这份小心在初见宝玉时也没有放下。";
  // The event underlines the caret's paragraph.
  await page.locator(".milkdown p", { hasText: "寄人篱下" }).click();
  await page.waitForTimeout(300);
  await page.evaluate(
    (target) =>
      window.dispatchEvent(
        new CustomEvent("levis:tutorial-mock-grammar", {
          detail: {
            target,
            issues: [
              {
                start: 2,
                end: 4,
                issue: "“毕竟”是固定写法。",
                suggestion: "毕竟",
                original: "必竟",
              },
              {
                start: 21,
                end: 25,
                issue: "“这份小心”与上文重复，可省略。",
                suggestion: "这份心",
                original: "这份小心",
              },
            ],
          },
        }),
      ),
    target,
  );
}

async function ask(page: Page) {
  await mockInvoke(page, { ai_agent_message: REPLY });
  const composer = page.locator(".agent-panel-view textarea");
  await composer.fill("把我的笔记改得精简一些，再帮我看看哪里还能写深。");
  await composer.press("Enter");
  await expect(page.locator(".milkdown .pending-pick")).toHaveCount(2);
}

for (const scheme of ["light", "dark"] as const) {
  test(`desktop ${scheme}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page, {
      storage: { "levis-agent-panel-open": "1" },
      colorScheme: scheme,
    });
    await paste(page);
    await ask(page);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${DIR}/desktop-${scheme}-1.png` });
    // Keep the second sentence as written.
    await page.locator(".milkdown .pending-pick-keep").nth(1).click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${DIR}/desktop-${scheme}-2.png` });
    // Hover the note's passage: it and its card light up together.
    await page.locator(".milkdown .review-anchor").first().hover();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${DIR}/desktop-${scheme}-3-note.png` });
    await grammar(page);
    await page.locator(".milkdown .grammar-issue").first().hover();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${DIR}/desktop-${scheme}-5-grammar.png` });
    await page.mouse.move(5, 5);
    // A narrow window: no room for a margin, the note sits behind a badge.
    await page.setViewportSize({ width: 900, height: 800 });
    await page.waitForTimeout(500);
    await page.locator(".review-badge").first().click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${DIR}/desktop-${scheme}-4-narrow.png` });
  });
}

test.describe("phone", () => {
  test.use(PHONE);
  test("phone light", async ({ page }) => {
    await openPhone(page, {});
    await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem("catvinci-settings") ?? "{}");
      localStorage.setItem(
        "catvinci-settings",
        JSON.stringify({ ...s, language: "zh" }),
      );
    });
    await page.reload();
    await page.waitForSelector('[data-active-tab="true"] .ProseMirror');
    await paste(page);
    await page.locator(".window-bar-toggle, .phone-ai-button").first().click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${DIR}/phone-1-sheet.png` });
    await ask(page);
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${DIR}/phone-2-review.png` });
    await page.locator(".review-bar-reject, .review-bar-button").last().click();
    await page.waitForTimeout(400);
    await page.locator(".review-badge").first().click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${DIR}/phone-3-note.png` });
    await page.locator(".bottom-card-primary").click();
    await page.waitForTimeout(400);
    await grammar(page);
    await page.locator(".milkdown .grammar-issue").first().tap();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${DIR}/phone-4-grammar.png` });
  });
});
