// Typora themes target Typora's DOM; most of it lines up with ours through
// the `#write` id alone (see MilkdownEditor), and code blocks carry the
// `md-fences` class (code-block-language-view.ts). The table header is the
// one structural gap no class can bridge: Milkdown renders the header row
// as a `<tr data-is-header>` inside `<tbody>`, with no `<thead>` at all, so
// a theme's `thead th` rules would never match anything.
const THEAD_SELECTOR = /\bthead\b(?:\s*>?\s*tr\b)?/g;

/** Rewrites an imported Typora theme's selectors onto Levis's editor DOM. */
export function adaptTyporaCss(css: string): string {
  return css.replace(THEAD_SELECTOR, "tr[data-is-header]");
}
