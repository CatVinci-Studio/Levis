// Page-seam layout for the macOS PDF export.
//
// A PDF page cannot have a painted margin here: WebKit never paints an
// @page margin, so dark or tinted themes would get white bands at the top
// and bottom of every sheet. Instead the sheet has no margin (the theme
// background bleeds to every edge) and the margin is laid out - the
// document is rendered at the paper's width, and every block that would
// cross a page seam, or start inside the top or bottom margin band, is
// pushed to the next page's top margin by a spacer.
//
// The layout must use the renderer's own sheet size in CSS px, or every
// computed seam drifts - and the two renderers differ (see export.rs):

/** The sheet as the PDF renderer lays it out, in CSS px. */
export interface PageGeometry {
  width: number;
  height: number;
  /** ~14mm: the band at the top and bottom of each sheet text stays out of. */
  margin: number;
}

/** macOS: WKWebView.createPDF renders 1 CSS px as 1 pt, so the sheet is A4
 *  in points - PAPER_WIDTH/HEIGHT in export.rs. (NSPrintOperation was not
 *  usable: its page height depends on the selected printer's imageable
 *  area, so no layout computed here could line up with it.) */
export const MAC_PAGE: PageGeometry = { width: 595, height: 842, margin: 40 };

/** Windows: WebView2's PrintToPdf at scale 1 lays out at 96 CSS px per
 *  inch - A4 is 794 x 1122.5 px, and pages are cut at whole pixels. */
export const WINDOWS_PAGE: PageGeometry = {
  width: 794,
  height: 1122,
  margin: 53,
};

const SPACER_CLASS = "levis-page-spacer";

// Containers whose children can start on a new page on their own. Anything
// else is moved as a whole, or left to split if it is taller than a page.
function isSplittable(el: Element): boolean {
  return /^(UL|OL|LI|BLOCKQUOTE|TBODY|TABLE|DIV)$/.test(el.tagName);
}

function makeSpacer(doc: Document, before: Element): HTMLElement {
  if (before.tagName === "TR") {
    const row = doc.createElement("tr");
    row.className = SPACER_CLASS;
    const cell = doc.createElement("td");
    cell.colSpan = Math.max(1, (before as HTMLTableRowElement).cells.length);
    cell.style.cssText = "padding:0;border:0;background:transparent";
    row.appendChild(cell);
    return row;
  }
  const div = doc.createElement(before.tagName === "LI" ? "li" : "div");
  div.className = SPACER_CLASS;
  div.setAttribute("aria-hidden", "true");
  div.style.cssText =
    "display:block;margin:0;padding:0;border:0;list-style:none;height:0";
  return div;
}

function setSpacerHeight(spacer: HTMLElement, height: number): void {
  const target =
    spacer.tagName === "TR"
      ? (spacer.firstElementChild as HTMLElement)
      : spacer;
  target.style.height = `${Math.max(0, height)}px`;
}

/** The next sibling that takes up space - a diagram's hidden source block
 *  sits between a label and the rendered diagram it introduces. */
function nextVisible(el: Element): Element | null {
  let next = el.nextElementSibling;
  while (next && next.getBoundingClientRect().height === 0)
    next = next.nextElementSibling;
  return next;
}

/** A heading, or a paragraph ending in a colon ("Label:"): a line that
 *  introduces the block after it. */
function introduces(el: Element): boolean {
  return (
    /^H[1-6]$/.test(el.tagName) ||
    (el.tagName === "P" && /[:：]\s*$/.test(el.textContent ?? ""))
  );
}

/**
 * Inserts spacers into `root` (already laid out at the page width) so no
 * block straddles a page seam or sits inside a margin band. Blocks are
 * handled in document order and re-measured after every insertion, since
 * each spacer moves everything after it.
 */
export function paginateDocument(
  doc: Document,
  root: Element,
  pageHeight = MAC_PAGE.height,
  margin = MAC_PAGE.margin,
): number {
  const usable = pageHeight - 2 * margin;
  const scrollTop = () => doc.defaultView?.scrollY ?? 0;
  const top = (el: Element) => el.getBoundingClientRect().top + scrollTop();
  const bottom = (el: Element) =>
    el.getBoundingClientRect().bottom + scrollTop();
  let inserted = 0;

  const place = (el: Element) => {
    const rect = el.getBoundingClientRect();
    if (rect.height === 0) return;
    const start = top(el);
    const page = Math.floor(start / pageHeight);
    const pageTop = page * pageHeight;
    const contentTop = pageTop + margin;
    const contentEnd = pageTop + pageHeight - margin;
    // A heading - or a "Label:" line introducing what follows - travels
    // with the next block, so it never ends a page on its own.
    const next = introduces(el) ? nextVisible(el) : null;
    const withNext = next ? bottom(next) : 0;
    const end = next && withNext - start <= usable ? withNext : bottom(el);

    // Too tall for any page: let its children find their own pages if it
    // has any; otherwise it splits wherever the engine puts the seam.
    if (rect.height > usable) {
      if (isSplittable(el)) {
        for (const child of Array.from(el.children)) place(child);
      }
      return;
    }

    let target: number | null = null;
    if (start < contentTop) target = contentTop;
    else if (end > contentEnd) target = contentTop + pageHeight;
    if (target === null) return;

    // Moving to the next page takes along the heading and label lines that
    // introduce this block, if they would otherwise stay behind at the
    // bottom of this one. (They were placed first and fit, since they only
    // looked one block ahead.)
    let anchor = el;
    if (target > contentEnd) {
      for (
        let prev = anchor.previousElementSibling;
        prev && introduces(prev) && top(prev) >= contentTop;
        prev = anchor.previousElementSibling
      ) {
        if (bottom(el) - top(prev) > usable) break;
        anchor = prev;
      }
    }

    const spacer = makeSpacer(doc, anchor);
    anchor.parentNode?.insertBefore(spacer, anchor);
    // Measured, not computed: the spacer breaks margin collapsing, so the
    // block's own top margin may now sit between the spacer and the block.
    setSpacerHeight(spacer, target - top(anchor));
    inserted++;
  };

  for (const child of Array.from(root.children)) place(child);

  // The theme background only reaches as far as the content, so the last
  // sheet would end in a white band. Fill it to an exact page multiple -
  // export.rs cuts the render into ceil(height / page) sheets.
  const body = doc.body;
  const height = doc.documentElement.scrollHeight;
  const fill = Math.ceil(height / pageHeight) * pageHeight - height;
  if (fill > 0) {
    const tail = doc.createElement("div");
    tail.className = SPACER_CLASS;
    tail.setAttribute("aria-hidden", "true");
    tail.style.cssText = `height:${fill}px`;
    body.appendChild(tail);
  }
  return inserted;
}

/**
 * Lays `html` out in a hidden frame at the paper width, paginates it, and
 * returns the result. Runs in the app's own webview, which is the same
 * engine as the offscreen print view, so line breaks and heights match.
 */
export async function paginateHtml(
  html: string,
  page: PageGeometry,
): Promise<string> {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  frame.style.cssText = `position:fixed;left:-${page.width * 4}px;top:0;width:${page.width}px;height:${page.height}px;border:0;visibility:hidden;pointer-events:none`;
  try {
    const loaded = new Promise<void>((resolve) => {
      frame.onload = () => resolve();
    });
    frame.srcdoc = html;
    document.body.appendChild(frame);
    await loaded;
    const doc = frame.contentDocument;
    if (!doc) return html;
    try {
      await doc.fonts.ready;
    } catch {
      // Font loading API unavailable - lay out with what is loaded.
    }
    await Promise.all(
      Array.from(doc.images).map((img) =>
        img.complete ? Promise.resolve() : img.decode().catch(() => undefined),
      ),
    );
    const root =
      doc.querySelector(".milkdown .ProseMirror") ??
      doc.querySelector(".milkdown");
    if (!root) return html;
    paginateDocument(doc, root, page.height, page.margin);
    return `<!doctype html>\n${doc.documentElement.outerHTML}`;
  } finally {
    frame.remove();
  }
}
