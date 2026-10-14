import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { openApp, pasteMarkdown } from "./helpers";

/**
 * The file-backed storage path (src-tauri/src/settings.rs): the page is
 * booted the way Rust boots a real window - the boot script itself
 * (src-tauri/src/boot.js) runs first with a snapshot - and the dev shim
 * stands in for the store behind the commands, exposing its state as
 * `window.__devStorage`. Every other spec runs without a snapshot, on the
 * localStorage fallback.
 */

const BOOT_JS = readFileSync(
  new URL("../src-tauri/src/boot.js", import.meta.url),
  "utf8",
);

interface DevStorage {
  settings: Record<string, unknown>;
  imports: number;
  patches: Record<string, unknown>[];
  uiState: Record<string, unknown>;
  histories: Record<string, { text?: string }[]>;
}

async function bootLikeRust(
  page: Page,
  boot: {
    settings: Record<string, unknown>;
    legacyImport?: boolean;
    uiState?: Record<string, unknown>;
  },
  themeCss: { light: string; dark: string | null } | null = null,
) {
  const snapshot = {
    rev: 1,
    label: "main",
    uiState: {},
    legacyImport: false,
    ...boot,
  };
  await page.addInitScript(
    ({ script, snapshot, themeCss }) => {
      // As Rust's boot_script does it.
      new Function(script)();
      (
        window as unknown as {
          __levisBoot: (boot: unknown, css: unknown) => void;
        }
      ).__levisBoot(snapshot, themeCss);
      // What the document looked like before any of the app's own code
      // ran: "interactive" is reached once the HTML is parsed, before the
      // (deferred) module scripts execute.
      document.addEventListener("readystatechange", () => {
        if (document.readyState !== "interactive") return;
        const root = document.documentElement;
        (window as unknown as { __firstPaint: unknown }).__firstPaint = {
          theme: root.getAttribute("data-theme"),
          width: root.getAttribute("data-content-width"),
          contentTheme: root.getAttribute("data-content-theme"),
          userTheme: root.getAttribute("data-user-theme"),
          lang: root.getAttribute("lang"),
          themeCss:
            document.getElementById("levis-custom-theme")?.textContent ?? null,
          customCss:
            document.getElementById("levis-user-css")?.textContent ?? null,
          // The user's CSS goes last, after the page's own styles.
          lastInHead: document.head.lastElementChild?.id ?? null,
        };
      });
    },
    { script: BOOT_JS, snapshot, themeCss },
  );
}

const devStorage = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __devStorage: DevStorage }).__devStorage,
  );

const emit = (page: Page, name: string, payload?: unknown) =>
  page.evaluate(
    ([event, data]) =>
      (
        window as unknown as {
          __devEmitTauriEvent: (name: string, payload?: unknown) => void;
        }
      ).__devEmitTauriEvent(event as string, data),
    [name, payload] as const,
  );

const SETTINGS = {
  language: "ja",
  languageChosen: true,
  onboardingShown: true,
  theme: "dark",
  themeId: "paper",
  contentWidth: "full",
  customCss: "#write { letter-spacing: 0.01em; }",
};

test("the boot script puts the appearance on the document before the app runs", async ({
  page,
}) => {
  await bootLikeRust(page, { settings: SETTINGS });
  await openApp(page, { settings: { language: "zh", theme: "light" } });
  const first = await page.evaluate(
    () => (window as unknown as { __firstPaint: unknown }).__firstPaint,
  );
  expect(first).toEqual({
    theme: "dark",
    width: "full",
    contentTheme: "paper",
    userTheme: null,
    lang: "ja",
    themeCss: null,
    customCss: SETTINGS.customCss,
    lastInHead: "levis-user-css",
  });
  // The snapshot, not localStorage (which openApp seeded with zh/light).
  const html = page.locator("html");
  await expect(html).toHaveAttribute("data-theme", "dark");
  await expect(html).toHaveAttribute("lang", "ja");
  // React took over the boot script's <style> rather than adding another.
  await expect(page.locator("style#levis-user-css")).toHaveCount(1);
  expect(
    await page.locator("style#levis-user-css").evaluate((el) => el.textContent),
  ).toBe(SETTINGS.customCss);
});

test("an imported theme is on the first frame, in the variant for the appearance", async ({
  page,
}) => {
  await bootLikeRust(
    page,
    {
      settings: {
        ...SETTINGS,
        themeId: "mine",
        userThemes: [{ id: "mine", name: "Mine", hasDark: true }],
      },
    },
    {
      light: "#write { color: rgb(1, 2, 3); }",
      dark: "#write thead th { color: rgb(4, 5, 6); }",
    },
  );
  await openApp(page);
  const first = await page.evaluate(
    () =>
      (window as unknown as { __firstPaint: Record<string, unknown> })
        .__firstPaint,
  );
  // Dark (pinned), with the Typora header selector rewritten as the
  // frontend does it, and before the user's CSS.
  expect(first.themeCss).toBe(
    "#write tr[data-is-header] th { color: rgb(4, 5, 6); }",
  );
  expect(first.userTheme).toBe("");
  expect(first.contentTheme).toBeNull();
  expect(first.lastInHead).toBe("levis-user-css");
});

test("a change goes to Rust as a patch of that field alone", async ({
  page,
}) => {
  await bootLikeRust(page, { settings: SETTINGS });
  await openApp(page);
  await emit(page, "menu-toggle-typewriter-mode");
  await expect
    .poll(async () => (await devStorage(page)).patches)
    .toEqual([{ typewriterMode: true }]);
  // localStorage is left as the backup a downgrade would read.
  const local = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("catvinci-settings") ?? "{}"),
  );
  expect(local.typewriterMode).toBeUndefined();
});

test("another window's change shows up here, except its zoom", async ({
  page,
}) => {
  await bootLikeRust(page, { settings: { ...SETTINGS, zoom: 1 } });
  await openApp(page);
  await emit(page, "settings-changed", {
    rev: 50,
    patch: { theme: "light", contentWidth: "standard", zoom: 2 },
    from: "window-2",
  });
  const html = page.locator("html");
  await expect(html).toHaveAttribute("data-theme", "light");
  await expect(html).toHaveAttribute("data-content-width", "standard");
  // An older event (delivered late) doesn't undo it.
  await emit(page, "settings-changed", {
    rev: 40,
    patch: { theme: "dark" },
    from: "window-3",
  });
  await page.waitForTimeout(100);
  await expect(html).toHaveAttribute("data-theme", "light");
  const zoom = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue(
      "--content-zoom",
    ),
  );
  expect(zoom.trim() === "" || zoom.trim() === "1").toBe(true);
});

test("the first launch after the move hands localStorage over once", async ({
  page,
}) => {
  await bootLikeRust(page, { settings: {}, legacyImport: true });
  await openApp(page, {
    settings: { theme: "dark", contentWidth: "full" },
    storage: {
      "levis-clipboard-history": JSON.stringify([{ text: "kept", at: 1 }]),
      "levis-agent-panel-open": "1",
    },
  });
  // Used straight from localStorage while the import is on its way.
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator(".agent-panel-view")).toBeVisible();
  await expect.poll(async () => (await devStorage(page)).imports).toBe(1);
  const stored = await devStorage(page);
  expect(stored.settings.theme).toBe("dark");
  expect(stored.settings.contentWidth).toBe("full");
  expect(stored.uiState.agentPanelOpen).toBe(true);
  expect(stored.histories.clipboard).toEqual([{ text: "kept", at: 1 }]);
  // Nothing removed from localStorage.
  expect(
    await page.evaluate(() => localStorage.getItem("levis-clipboard-history")),
  ).toContain("kept");
});

test("clipboard history is recorded entry by entry in the store", async ({
  page,
}) => {
  await bootLikeRust(page, { settings: SETTINGS });
  await openApp(page);
  await pasteMarkdown(page, "pasted words");
  await expect
    .poll(async () => (await devStorage(page)).histories.clipboard)
    .toEqual([expect.objectContaining({ text: "pasted words" })]);
  expect(
    await page.evaluate(() => localStorage.getItem("levis-clipboard-history")),
  ).toBeNull();
});
