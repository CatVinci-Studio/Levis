import { expect, test, type Page } from "@playwright/test";
import { mockInvoke, openApp } from "./helpers";

/**
 * The AI panel's Memory tab and the project files it opens (.textus/):
 * each opens as a document of its own, in a new tab beside the one being
 * written.
 */

const ENTRY_PATH = "/notes/.textus/library/Lin.md";

const workspace = (library: unknown[]) => ({
  instructions: [],
  project_instructions: "",
  skills: [],
  root: "/notes",
  style: null,
  library,
});

async function createEntry(page: Page, name: string) {
  await page.locator("#agent-tab-memory").click();
  await page
    .locator(".memory-section", { hasText: "Library" })
    .getByRole("button", { name: "New" })
    .click();
  await page.getByPlaceholder("Name of a character, place or term").fill(name);
  await page.getByRole("button", { name: "Create", exact: true }).click();
}

test("a new library entry opens with the panel still on Memory", async ({
  page,
}) => {
  await openApp(page, {
    settings: { language: "en" },
    storage: { "levis-agent-panel-open": "1" },
  });
  await mockInvoke(page, {
    load_agent_workspace: workspace([]),
    ensure_project_file: ENTRY_PATH,
    read_text_file: "---\nname: Lin\naliases: []\ninclude: detected\n---\n\n",
  });
  await createEntry(page, "Lin");
  // The entry opened in a tab of its own...
  await expect(page.locator(".tab-pill")).toHaveCount(2);
  // ...and the panel, now drawn by that tab's editor, is still on Memory.
  await expect(page.locator("#agent-tab-memory")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator(".agent-panel-memory")).toBeVisible();
});

test("a new library entry shows its template's comment as a note, not markup", async ({
  page,
}) => {
  await openApp(page, {
    settings: { language: "en" },
    storage: { "levis-agent-panel-open": "1" },
  });
  // What projectLibraryTemplate writes (i18n/locales/en.ts).
  const note =
    "Facts Textus AI should keep consistent whenever Lin or an alias comes up. Comments like this one are never sent.";
  await mockInvoke(page, {
    load_agent_workspace: workspace([]),
    ensure_project_file: ENTRY_PATH,
    read_text_file: `---\nname: Lin\naliases: []\ninclude: detected\n---\n\n<!-- ${note} -->\n\n`,
  });
  await createEntry(page, "Lin");
  await expect(page.locator(".tab-pill")).toHaveCount(2);
  const editor = page.locator('[data-active-tab="true"] .ProseMirror');
  await expect(editor.locator(".raw-html-comment")).toHaveText(note);
  await expect(editor).not.toContainText("<!--", { useInnerText: true });
  // The caret on it gives the markup back, to edit.
  await editor.locator(".raw-html-comment").click();
  await expect(editor).toContainText(`<!-- ${note} -->`, {
    useInnerText: true,
  });
  await expect(editor.locator(".raw-html-comment")).toHaveCount(0);
});
