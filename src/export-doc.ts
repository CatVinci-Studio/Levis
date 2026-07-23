import { ask, message } from "@tauri-apps/plugin-dialog";
import type { Strings } from "./i18n/strings";
import { basename, dirname } from "./utils/path";
import { tabTitle, type DocTab } from "./doc-tabs";
import { exportDoc, fs } from "./ipc";

// File > Export implementations (HTML serializes the live editor DOM;
// everything else converts through a user-installed pandoc; PDF drives the
// system print panel after a themed-render pass - see exportPdf below).

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

// --- PDF export -----------------------------------------------------------
//
// PDF hands off to the system print panel (WKWebView's "Save as PDF"), but
// unlike a bare window.print() this first shows a progress overlay and waits
// for the document to finish rendering, so large docs (many images, mermaid
// diagrams, KaTeX) don't hit the panel half-painted. The print output itself
// is the live editor DOM under App.css's @media print rules, which pin the
// current editor theme (--editor-* colors, backgrounds) onto the page.

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

// Injects the "Preparing PDF…" overlay. It carries .pdf-export-overlay, which
// App.css's @media print hides, so it never bleeds into the printed page even
// though it's still mounted when window.print() fires.
function showPdfOverlay(t: Strings): HTMLElement {
  const el = document.createElement("div");
  el.className = "pdf-export-overlay";
  el.innerHTML = `<div class="pdf-export-card"><div class="pdf-export-spinner" aria-hidden="true"></div><div class="pdf-export-text">${escapeHtml(t.pdfPreparing)}</div><div class="pdf-export-hint">${escapeHtml(t.pdfPreparingHint)}</div></div>`;
  document.body.appendChild(el);
  return el;
}

// Waits for the async parts of the render to settle before printing: web
// fonts (theme fonts like the Parchment script face) and every image the
// editor holds. Diagrams and math are already inline SVG/HTML in the DOM by
// the time this runs, so no extra pass is needed for them.
async function settleForPrint(editor: HTMLElement): Promise<void> {
  try {
    await document.fonts.ready;
  } catch {
    // Font loading API unavailable or rejected - print with what's loaded.
  }
  const images = Array.from(editor.querySelectorAll("img"));
  await Promise.all(
    images.map((img) =>
      img.complete && img.naturalWidth > 0
        ? Promise.resolve()
        : img.decode().catch(() => undefined),
    ),
  );
  // One more frame so any layout from decoded images/fonts is committed.
  await nextFrame();
}

// File > Export as PDF. Requires the WYSIWYG view (source mode has no themed
// DOM to print) and prints the active tab as-is - unsaved edits included.
export async function exportPdf(_tab: DocTab, t: Strings): Promise<void> {
  const editor = document.querySelector<HTMLElement>(
    '[data-active-tab="true"] .milkdown',
  );
  if (!editor) {
    await message(t.exportNeedsWysiwyg, { title: t.exportFailedTitle });
    return;
  }
  const overlay = showPdfOverlay(t);
  try {
    // Two frames so the overlay actually paints before the (synchronous,
    // blocking) print panel takes over the window.
    await nextFrame();
    await nextFrame();
    await settleForPrint(editor);
    window.print();
  } catch (err) {
    await message(`${t.pdfFailed} ${String(err)}`, {
      title: t.exportFailedTitle,
      kind: "error",
    });
  } finally {
    overlay.remove();
  }
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
