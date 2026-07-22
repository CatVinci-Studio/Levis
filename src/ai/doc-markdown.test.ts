import { describe, expect, it } from "vitest";
import {
  composeMarkdownEdit,
  documentMarkdown,
  findMarkdownMatch,
  type MarkdownBlock,
} from "./doc-markdown";

/** Builds blocks the way serializeBlocks would, with fake ProseMirror
 *  positions - the matching logic only cares that they're monotonic. */
function blocks(...markdown: string[]): MarkdownBlock[] {
  let offset = 0;
  let pos = 0;
  return markdown.map((md) => {
    const block = { from: pos, to: pos + md.length + 2, markdown: md, offset };
    offset += md.length + 2;
    pos = block.to;
    return block;
  });
}

describe("documentMarkdown", () => {
  it("joins blocks with a blank line", () => {
    expect(documentMarkdown(blocks("# Title", "Body text"))).toBe(
      "# Title\n\nBody text",
    );
  });
});

describe("findMarkdownMatch", () => {
  it("matches a snippet carrying markdown syntax", () => {
    const doc = blocks("This is **important** content");
    const match = findMarkdownMatch(doc, "**important**");
    expect(match).not.toBeNull();
    expect(match!.prefix).toBe("This is ");
    expect(match!.suffix).toBe(" content");
  });

  it("snaps the range outward to whole blocks", () => {
    const doc = blocks("First para", "Second para");
    const match = findMarkdownMatch(doc, "Second");
    // Range covers block 2 entirely, not just the word.
    expect(match!.from).toBe(doc[1].from);
    expect(match!.to).toBe(doc[1].to);
    expect(match!.markdown).toBe("Second para");
  });

  it("spans consecutive blocks when the snippet crosses them", () => {
    const doc = blocks("## Heading", "Body", "Tail");
    const match = findMarkdownMatch(doc, "## Heading\n\nBody");
    expect(match!.from).toBe(doc[0].from);
    expect(match!.to).toBe(doc[1].to);
    expect(match!.prefix).toBe("");
    expect(match!.suffix).toBe("");
  });

  it("rejects an ambiguous snippet", () => {
    expect(findMarkdownMatch(blocks("same", "same"), "same")).toBeNull();
  });

  it("rejects a snippet that isn't there", () => {
    expect(findMarkdownMatch(blocks("hello"), "goodbye")).toBeNull();
  });

  it("rejects an empty snippet rather than matching everywhere", () => {
    expect(findMarkdownMatch(blocks("hello"), "")).toBeNull();
  });

  // The shape that produced strings of "Couldn't locate that text": prose
  // where the natural anchor ("GPT 5.6 sol", "Levis") repeats across
  // paragraphs, so every plain anchor died as ambiguous.
  it("disambiguates a repeated anchor through a unique context", () => {
    const doc = blocks(
      "I used GPT 5.6 sol to build Levis.",
      "Levis brings the **latest LLMs, including GPT 5.6 sol**, to markdown.",
    );
    expect(findMarkdownMatch(doc, "GPT 5.6 sol")).toBeNull();
    const match = findMarkdownMatch(
      doc,
      "GPT 5.6 sol",
      "including GPT 5.6 sol**, to markdown",
    );
    expect(match).not.toBeNull();
    expect(match!.from).toBe(doc[1].from);
    expect(match!.prefix.endsWith("including ")).toBe(true);
  });

  it("rejects a context that is itself absent, repeated, or anchor-free", () => {
    const doc = blocks("a same b", "c same d");
    expect(findMarkdownMatch(doc, "same", "not in the document")).toBeNull();
    expect(findMarkdownMatch(doc, "same", "same")).toBeNull();
    const repeated = blocks("x same y", "x same y");
    expect(findMarkdownMatch(repeated, "same", "x same y")).toBeNull();
  });

  it("tolerates a quote that folded the blank line between blocks", () => {
    const doc = blocks("## Heading", "Body text");
    const match = findMarkdownMatch(doc, "## Heading\nBody text");
    expect(match).not.toBeNull();
    expect(match!.from).toBe(doc[0].from);
    expect(match!.to).toBe(doc[1].to);
  });

  it("keeps the whitespace-tolerant retry unique and word-exact", () => {
    expect(
      findMarkdownMatch(blocks("one two", "one two"), "one\ntwo"),
    ).toBeNull();
    expect(findMarkdownMatch(blocks("onetwo"), "one\ntwo")).toBeNull();
  });
});

describe("composeMarkdownEdit", () => {
  const doc = blocks("This is **important** content");
  const match = findMarkdownMatch(doc, "**important**")!;

  it("preserves surrounding markdown on replace", () => {
    expect(composeMarkdownEdit(match, "replace", "**vital**")).toBe(
      "This is **vital** content",
    );
  });

  it("drops only the snippet on delete", () => {
    expect(composeMarkdownEdit(match, "delete", "")).toBe("This is  content");
  });

  it("keeps the snippet when inserting around it", () => {
    expect(composeMarkdownEdit(match, "insert_before", "NEW")).toBe(
      "This is NEW\n\n**important** content",
    );
    expect(composeMarkdownEdit(match, "insert_after", "NEW")).toBe(
      "This is **important**\n\nNEW content",
    );
  });

  it("round-trips a heading without losing its level", () => {
    const headings = blocks("## Project Background", "Body");
    const m = findMarkdownMatch(headings, "## Project Background")!;
    expect(composeMarkdownEdit(m, "replace", "## Background")).toBe(
      "## Background",
    );
  });

  it("keeps the DOCUMENT's whitespace when the quote folded it", () => {
    // The model quoted "## Heading\nBody" for a doc reading
    // "## Heading\n\nBody" - inserting after it must keep the blank line.
    const doc = blocks("## Heading", "Body");
    const m = findMarkdownMatch(doc, "## Heading\nBody")!;
    expect(composeMarkdownEdit(m, "insert_after", "NEW")).toBe(
      "## Heading\n\nBody\n\nNEW",
    );
  });
});
