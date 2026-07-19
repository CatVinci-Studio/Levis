/**
 * Whitelist renderer for the raw HTML raw-html-schema.ts stores as real
 * text: common README-style markup (alignment wrappers, images, headings,
 * bold/italic, links) gets rebuilt into a small, sanitized DOM tree;
 * anything else - `<script>`, `<iframe>`, a snippet whose outermost tag
 * isn't in the whitelist - returns null so the caller falls back to
 * showing the raw text plainly (today's existing behavior).
 *
 * This is deliberately not general HTML sanitization (no DOMPurify or
 * similar): a fixed, small tag/attribute whitelist plus URL scheme
 * validation on the two attributes that can actually carry an XSS payload
 * (`href`, `src`).
 */

const CONTAINER_TAGS = new Set([
  "p",
  "div",
  "span",
  "center",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
]);
// Inline-level tags: a fragment made only of these (plus text) renders as
// an inline widget that stays in the surrounding line, instead of a block.
const INLINE_TAGS = new Set([
  "span",
  "img",
  "br",
  "strong",
  "em",
  "b",
  "i",
  "a",
  "sub",
  "sup",
  "u",
  "s",
  "del",
  "ins",
  "mark",
  "kbd",
  "code",
  "small",
]);
const WHITELISTED_TAGS = new Set([...CONTAINER_TAGS, ...INLINE_TAGS]);
// Dropped along with their children - the actual attack surface, distinct
// from "just not in the whitelist" (which unwraps instead, keeping content).
const DANGEROUS_TAGS = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "form",
]);

const ALIGN_VALUES = new Set(["left", "center", "right", "justify"]);
function sanitizeAlign(value: string): string | null {
  const lower = value.toLowerCase();
  return ALIGN_VALUES.has(lower) ? lower : null;
}

function sanitizeDimension(value: string): string | null {
  return /^\d+(%|px)?$/.test(value) ? value : null;
}

const ALLOWED_URL_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);
/** Rejects javascript:/data:/vbscript:/etc.; relative and scheme-less URLs
 *  (the common case for local images/links) resolve against the dummy base
 *  and come out as "http:", so they pass through unchanged. */
function sanitizeUrl(value: string): string | null {
  try {
    const resolved = new URL(value, "http://localhost/");
    return ALLOWED_URL_PROTOCOLS.has(resolved.protocol) ? value : null;
  } catch {
    return null;
  }
}

const ATTR_RULES: Record<
  string,
  Record<string, (value: string) => string | null>
> = {
  img: {
    src: sanitizeUrl,
    alt: (v) => v,
    title: (v) => v,
    width: sanitizeDimension,
    height: sanitizeDimension,
  },
  a: {
    href: sanitizeUrl,
    title: (v) => v,
  },
};

function cleanNode(node: ChildNode, out: HTMLElement): void {
  if (node.nodeType === Node.TEXT_NODE) {
    out.appendChild(document.createTextNode(node.textContent ?? ""));
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return; // comments, etc. - dropped

  const el = node as Element;
  const tag = el.tagName.toLowerCase();

  if (DANGEROUS_TAGS.has(tag)) return; // drop entirely, including content

  if (!WHITELISTED_TAGS.has(tag)) {
    // Unwrap: not dangerous, just not something we render specially - keep
    // its sanitized children in place of the tag itself.
    for (const child of Array.from(el.childNodes)) cleanNode(child, out);
    return;
  }

  const clean = document.createElement(tag);
  if (CONTAINER_TAGS.has(tag)) {
    const align = el.getAttribute("align");
    if (align) {
      const safe = sanitizeAlign(align);
      if (safe) clean.setAttribute("align", safe);
    }
  }
  const rules = ATTR_RULES[tag];
  if (rules) {
    for (const [attr, validate] of Object.entries(rules)) {
      const value = el.getAttribute(attr);
      if (value == null) continue;
      const safe = validate(value);
      if (safe != null) clean.setAttribute(attr, safe);
    }
  }
  if (tag === "a") {
    clean.setAttribute("rel", "noopener noreferrer");
    clean.setAttribute("target", "_blank");
  }
  for (const child of Array.from(el.childNodes)) cleanNode(child, clean);
  out.appendChild(clean);
}

export function renderWhitelistedHtml(
  raw: string,
): { html: string; inline: boolean } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const parsed = new DOMParser().parseFromString(trimmed, "text/html");
  const body = parsed.body;
  const firstElement = Array.from(body.childNodes).find(
    (n) => n.nodeType === Node.ELEMENT_NODE,
  ) as Element | undefined;
  if (
    !firstElement ||
    !WHITELISTED_TAGS.has(firstElement.tagName.toLowerCase())
  )
    return null;

  const wrapper = document.createElement("div");
  for (const child of Array.from(body.childNodes)) cleanNode(child, wrapper);
  // Inline iff nothing block-level survived at the top: the widget then
  // flows with the line it sits in (GitHub renders e.g. a lone <img> or
  // <kbd>x</kbd> inline, not as its own paragraph).
  const inline = Array.from(wrapper.children).every((el) =>
    INLINE_TAGS.has(el.tagName.toLowerCase()),
  );
  return { html: wrapper.innerHTML, inline };
}
