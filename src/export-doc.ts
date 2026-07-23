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

// --- Standalone document HTML (shared by HTML and PDF export) --------------
//
// Both exports serialize the live editor DOM - what you see is what exports -
// into a self-contained page with every stylesheet inlined. The current
// editor theme is reproduced by mirroring the app root's data-theme /
// data-content-theme onto the exported <html> (that's what content-themes.css
// keys its --editor-* variables off) and keeping the same ancestor classes.

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

// Inlines every same-origin stylesheet's rules into one string.
function collectInlinedCss(): string {
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
  return css;
}

// Clones the editor subtree, stripping contenteditable so the export is inert.
function cloneEditorContent(editor: Element): string {
  const clone = editor.cloneNode(true) as HTMLElement;
  clone
    .querySelectorAll("[contenteditable]")
    .forEach((el) => el.removeAttribute("contenteditable"));
  return clone.outerHTML;
}

// Wraps serialized editor content in a full themed document. `layoutCss` frees
// it from the app's fixed-viewport layout (each export tunes its own page).
function buildStandaloneHtml(
  base: string,
  contentHtml: string,
  layoutCss: string,
): string {
  const root = document.documentElement;
  const dataTheme = root.getAttribute("data-theme");
  const contentTheme = root.getAttribute("data-content-theme");
  const rootAttrs =
    (dataTheme ? ` data-theme="${escapeHtml(dataTheme)}"` : "") +
    (contentTheme ? ` data-content-theme="${escapeHtml(contentTheme)}"` : "");
  return `<!doctype html>
<html${rootAttrs}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(base)}</title>
<style>${collectInlinedCss()}</style>
<style>${layoutCss}</style>
</head>
<body class="${document.body.className}">
<div class="app-shell"><div class="main-pane"><div class="editor-scroll"><div class="editor-content">${contentHtml}</div></div></div></div>
</body>
</html>`;
}

// --- PDF export -------------------------------------------------------------
//
// wry's window.print() on macOS drives a broken NSPrintPanel (flashes and
// self-dismisses - tauri-apps/wry#713, tauri#6202), so PDF doesn't go through
// printing at all. Instead we build the same self-contained themed document as
// HTML export and hand it to a Rust command that renders it in an offscreen
// WKWebView and writes a real .pdf via -createPDFWithConfiguration:. A progress
// overlay covers the render/write, since createPDF is async and can take a
// moment on large docs.

// Fills the page with the theme background and uses padding as page margins,
// so the PDF matches the editor theme (dark themes included). The page width
// is fixed by the offscreen WKWebView frame on the Rust side.
const PDF_LAYOUT_CSS =
  "html, body { margin: 0; background: var(--editor-bg, var(--bg)); } " +
  ".app-shell, .main-pane, .editor-scroll { height: auto; overflow: visible; background: transparent; } " +
  ".editor-content, .editor-content.typewriter-active { padding: 56px; }";

const HTML_LAYOUT_CSS =
  ".app-shell, .main-pane, .editor-scroll { height: auto; overflow: visible; } " +
  ".editor-content { padding: 2rem 0; }";

// Injects the "Preparing PDF…" progress overlay (removed when export ends).
function showPdfOverlay(t: Strings): HTMLElement {
  const el = document.createElement("div");
  el.className = "pdf-export-overlay";
  el.innerHTML = `<div class="pdf-export-card"><div class="pdf-export-spinner" aria-hidden="true"></div><div class="pdf-export-text">${escapeHtml(t.pdfPreparing)}</div></div>`;
  document.body.appendChild(el);
  return el;
}

// Lets web fonts (theme fonts like Parchment's script face) and images settle
// before serializing, so the offscreen render doesn't miss them. Diagrams and
// math are already inline SVG/HTML in the DOM, so no extra pass is needed.
async function settleRender(editor: Element): Promise<void> {
  try {
    await document.fonts.ready;
  } catch {
    // Font loading API unavailable or rejected - continue with what's loaded.
  }
  const images = Array.from(editor.querySelectorAll("img"));
  await Promise.all(
    images.map((img) =>
      img.complete && img.naturalWidth > 0
        ? Promise.resolve()
        : img.decode().catch(() => undefined),
    ),
  );
  await nextFrame();
}

// File > Export as PDF. Requires the WYSIWYG view (source mode has no themed
// DOM) and exports the active tab as-is - unsaved edits included.
export async function exportPdf(tab: DocTab, t: Strings): Promise<void> {
  const editor = document.querySelector('[data-active-tab="true"] .milkdown');
  if (!editor) {
    await message(t.exportNeedsWysiwyg, { title: t.exportFailedTitle });
    return;
  }
  const base = exportBaseName(tab, t);
  const picked = await exportDoc.exportSaveDialog(`${base}.pdf`, "PDF", "pdf");
  if (!picked) return;
  const overlay = showPdfOverlay(t);
  try {
    await nextFrame();
    await settleRender(editor);
    const html = buildStandaloneHtml(
      base,
      cloneEditorContent(editor),
      PDF_LAYOUT_CSS,
    );
    await exportDoc.exportPdfNative({
      html,
      outputPath: picked,
      // Resolves relative image srcs (assets/...) against the document folder.
      baseDir: tab.path ? dirname(tab.path) : null,
    });
    void exportDoc.revealInDir(picked);
  } catch (err) {
    await message(`${t.pdfFailed} ${String(err)}`, {
      title: t.exportFailedTitle,
      kind: "error",
    });
  } finally {
    overlay.remove();
  }
}

// Serializes the tab's live editor DOM into a self-contained HTML file.
// Relative image paths (assets/...) are kept as-is, like Typora's HTML export
// next to the document.
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
  const html = buildStandaloneHtml(
    base,
    cloneEditorContent(editor),
    HTML_LAYOUT_CSS,
  );
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
