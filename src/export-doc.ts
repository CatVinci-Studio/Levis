import { ask, message } from "@tauri-apps/plugin-dialog";
import type { Strings } from "./i18n/strings";
import { basename, dirname } from "./utils/path";
import { tabTitle, type DocTab } from "./doc-tabs";
import { exportDoc, fs } from "./ipc";

// File > Export implementations (HTML serializes the live editor DOM;
// everything else converts through a user-installed pandoc). PDF isn't here:
// it's just window.print() via the system print panel (see App.tsx's
// menu-export-pdf listener).

// Keys are pandoc writer names, matching the export menu ids Rust builds in
// menu.rs (EXPORT_PANDOC_PREFIX) - the two lists must stay in step.
const PANDOC_FORMATS: Record<string, { ext: string; label: string }> = {
  docx: { ext: "docx", label: "Word" },
  odt: { ext: "odt", label: "OpenDocument" },
  rtf: { ext: "rtf", label: "RTF" },
  epub: { ext: "epub", label: "EPUB" },
  latex: { ext: "tex", label: "LaTeX" },
  mediawiki: { ext: "wiki", label: "MediaWiki" },
  rst: { ext: "rst", label: "reStructuredText" },
  textile: { ext: "textile", label: "Textile" },
  opml: { ext: "opml", label: "OPML" },
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// The export's default filename stem: the document's name without its
// extension, or the tab title for drafts.
function exportBaseName(tab: DocTab, t: Strings): string {
  return tab.path
    ? basename(tab.path).replace(/\.[^.]+$/, "")
    : tabTitle(tab, t);
}

// Serializes the tab's live editor DOM - what you see is what exports -
// with every stylesheet inlined so the file is self-contained. Relative
// image paths (assets/...) are kept as-is, like Typora's HTML export next
// to the document.
export async function exportHtml(tab: DocTab, t: Strings): Promise<void> {
  const editor = document.querySelector('[data-active-tab="true"] .milkdown');
  if (!editor) {
    await message(t.exportNeedsWysiwyg, { title: t.exportFailedTitle });
    return;
  }
  const base = exportBaseName(tab, t);
  const picked = await exportDoc.exportSaveDialog(
    `${base}.html`,
    "HTML",
    "html",
  );
  if (!picked) return;
  const clone = editor.cloneNode(true) as HTMLElement;
  clone
    .querySelectorAll("[contenteditable]")
    .forEach((el) => el.removeAttribute("contenteditable"));
  let css = "";
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      css += Array.from(sheet.cssRules)
        .map((rule) => rule.cssText)
        .join("\n");
      css += "\n";
    } catch {
      // Cross-origin sheet (none in practice) - skip.
    }
  }
  // Same ancestor classes as the app so theme selectors keep applying,
  // plus overrides freeing the page from the app's fixed-viewport layout.
  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(base)}</title>
<style>${css}</style>
<style>.app-shell, .main-pane, .editor-scroll { height: auto; overflow: visible; } .editor-content { padding: 2rem 0; }</style>
</head>
<body class="${document.body.className}">
<div class="app-shell"><div class="main-pane"><div class="editor-scroll"><div class="editor-content">${clone.outerHTML}</div></div></div></div>
</body>
</html>`;
  await fs.writeTextFile(picked, html);
  void exportDoc.revealInDir(picked);
}

export async function exportViaPandoc(
  tab: DocTab,
  format: string,
  t: Strings,
): Promise<void> {
  const info = PANDOC_FORMATS[format];
  if (!info) return;
  const pandoc = await exportDoc.detectPandoc();
  if (!pandoc) {
    // Typora's model: guide the user to install pandoc rather than
    // bundling the ~180MB GPL binary in the app.
    const goInstall = await ask(t.pandocMissingMessage, {
      title: t.pandocMissingTitle,
      okLabel: t.pandocMissingDownload,
      cancelLabel: t.closePromptCancel,
    });
    if (goInstall) void exportDoc.openPandocInstallPage();
    return;
  }
  const base = exportBaseName(tab, t);
  const picked = await exportDoc.exportSaveDialog(
    `${base}.${info.ext}`,
    info.label,
    info.ext,
  );
  if (!picked) return;
  try {
    // tab.content, not the file on disk - unsaved edits export too.
    await exportDoc.exportViaPandoc({
      pandocPath: pandoc,
      markdown: tab.content,
      outputPath: picked,
      format,
      resourceDir: tab.path ? dirname(tab.path) : null,
      title: base,
    });
    void exportDoc.revealInDir(picked);
  } catch (err) {
    await message(`${t.exportFailed} ${String(err)}`, {
      title: t.exportFailedTitle,
      kind: "error",
    });
  }
}
