import { ask, message } from "@tauri-apps/plugin-dialog";
import type { Strings } from "./i18n/strings";
import { basename, dirname } from "./utils/path";
import { tabTitle, type DocTab } from "./doc-tabs";
import { exportDoc, fs } from "./ipc";
import { isMacPlatform } from "./utils/platform";
import { PDF_PAGE_MARGIN, paginateHtml } from "./export-paginate";

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

// Editing affordances that live in the editor DOM but are not document
// content: heading "#" markers, the code-block language picker, table
// insert buttons, delimiters shown around the caret, AI previews. Kept in
// step with the @media print list in App.css (the Windows/Linux PDF path
// prints the live DOM, so it can only hide them).
const EDITOR_CHROME_SELECTOR = [
  ".heading-marker",
  ".enclosure-delimiter",
  ".code-block-header",
  ".table-add-row-btn",
  ".table-add-col-btn",
  ".ghost-text",
  ".quick-ask-anchor",
  ".pending-insert",
  ".image-resize-handle",
].join(", ");

// A resized table carries pixel widths (an inline table width plus one per
// <col>, see table-hover-view.ts) sized for the editor column. On a page
// narrower than that column they overflow and are cut off at the page edge,
// so the export keeps each column's share of the width instead.
function fitTablesToWidth(root: HTMLElement): void {
  root.querySelectorAll("table").forEach((table) => {
    table.style.width = "";
    table.style.minWidth = "";
    const cols = Array.from(table.querySelectorAll(":scope > colgroup > col"));
    const widths = cols.map(
      (col) => parseFloat((col as HTMLElement).style.width) || 0,
    );
    const total = widths.reduce((sum, width) => sum + width, 0);
    cols.forEach((col, i) => {
      const style = (col as HTMLElement).style;
      // Unsized columns share what the sized ones leave.
      style.width =
        total > 0 && widths[i] > 0 && widths.every((w) => w > 0)
          ? `${((widths[i] / total) * 100).toFixed(3)}%`
          : "";
    });
  });
}

// Local images render through asset: URLs (image-plugin.ts), which resolve
// only inside this app. A file exported next to the document wants the
// markdown's own paths back ("document"); a self-contained render wants the
// pixels themselves ("inline", see inlineImages).
export type ExportImages = "document" | "inline";

// Clones the editor subtree, stripping contenteditable so the export is inert.
export function cloneEditorContent(
  editor: Element,
  images: ExportImages = "document",
): string {
  const clone = editor.cloneNode(true) as HTMLElement;
  clone
    .querySelectorAll("[contenteditable]")
    .forEach((el) => el.removeAttribute("contenteditable"));
  clone.querySelectorAll(EDITOR_CHROME_SELECTOR).forEach((el) => el.remove());
  fitTablesToWidth(clone);
  clone
    .querySelectorAll<HTMLImageElement>("img[data-doc-src]")
    .forEach((img) => {
      if (images === "document")
        img.setAttribute("src", img.dataset.docSrc ?? "");
      img.removeAttribute("data-doc-src");
    });
  return clone.outerHTML;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// Replaces every asset: image in `html` with a data URL, so a render in a
// webview that has no asset protocol (the macOS PDF path) still shows it.
// An image that can't be read is left as-is rather than failing the export.
export async function inlineImages(html: string): Promise<string> {
  const template = document.createElement("template");
  template.innerHTML = html;
  const local = Array.from(
    template.content.querySelectorAll<HTMLImageElement>("img[src]"),
  ).filter((img) => /^(asset|https?:\/\/asset\.localhost)/i.test(img.src));
  await Promise.all(
    local.map(async (img) => {
      try {
        const response = await fetch(img.src);
        if (response.ok) img.src = await blobToDataUrl(await response.blob());
      } catch {
        // Unreadable - keep the original src.
      }
    }),
  );
  return template.innerHTML;
}

// Wraps serialized editor content in a full themed document. `layoutCss` frees
// it from the app's fixed-viewport layout (each export tunes its own page).
export function buildStandaloneHtml(
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
// Windows/Linux export PDF by printing the page (window.print → Save as PDF;
// their engines print fine, and Chromium paints the theme background into
// the @page margin). macOS can't: wry's window.print() drives a broken
// NSPrintPanel (flashes and self-dismisses - tauri-apps/wry#713, tauri#6202),
// so there the themed document is laid out into A4 pages here
// (export-paginate.ts) and rendered straight to a file natively - vector,
// selectable text (see export_pdf_native in Rust).

const isMac = isMacPlatform();

// Layout shared by every export: content too wide for a page wraps or
// shrinks to fit instead of being clipped at the sheet edge. Display math
// is a scroll box on screen; a page cannot scroll, so let KaTeX break at
// its top-level operators like inline math does.
const EXPORT_FIT_CSS =
  ".milkdown table { width: 100%; } " +
  ".math-block-rendered, .katex-display { overflow: visible; } " +
  ".katex-display > .katex { white-space: normal; } " +
  ".milkdown a, .milkdown p, .milkdown li, .milkdown td, .milkdown th { overflow-wrap: anywhere; } ";

// Theme + page CSS for the offscreen macOS render. The sheet margin stays
// zero so the theme background bleeds to every edge - WebKit never paints
// an @page margin, which would leave white bands on tinted themes. The
// top and bottom margins are laid out instead, by export-paginate.ts
// pushing blocks off each page seam; the side inset is plain padding.
// print-color-adjust keeps the editor theme's backgrounds from being
// flattened to white per page.
export const PDF_LAYOUT_CSS =
  ":root { -webkit-print-color-adjust: exact; print-color-adjust: exact; } " +
  "@page { margin: 0; } " +
  "html, body { margin: 0; background: var(--editor-bg, var(--bg)); } " +
  ".app-shell, .main-pane, .editor-scroll { height: auto; overflow: visible; background: transparent; } " +
  `.editor-content, .editor-content.typewriter-active { max-width: none; padding: ${PDF_PAGE_MARGIN}px 56px 0; } ` +
  EXPORT_FIT_CSS;

const HTML_LAYOUT_CSS =
  ".app-shell, .main-pane, .editor-scroll { height: auto; overflow: visible; } " +
  ".editor-content { padding: 2rem 1.5rem; } " +
  EXPORT_FIT_CSS;

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
  if (!isMac) {
    // Windows/Linux: the webview's own print → Save as PDF. App.css's @media
    // print hides the app chrome and themes the page.
    window.print();
    return;
  }
  const base = exportBaseName(tab, t);
  const picked = await exportDoc.exportSaveDialog(`${base}.pdf`, "PDF", "pdf");
  if (!picked) return;
  const overlay = showPdfOverlay(t);
  try {
    await nextFrame();
    await settleRender(editor);
    const content = await inlineImages(cloneEditorContent(editor, "inline"));
    const html = await paginateHtml(
      buildStandaloneHtml(base, content, PDF_LAYOUT_CSS),
    );
    // Resolves once the file is written.
    await exportDoc.exportPdfNative({
      html,
      // Resolves relative image srcs (assets/...) against the document folder.
      baseDir: tab.path ? dirname(tab.path) : null,
      outputPath: picked,
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
