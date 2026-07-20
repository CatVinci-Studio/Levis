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
});

describe("composeMarkdownEdit", () => {
  const doc = blocks("This is **important** content");
  const match = findMarkdownMatch(doc, "**important**")!;

  it("preserves surrounding markdown on replace", () => {
    expect(
      composeMarkdownEdit(match, "replace", "**important**", "**vital**"),
    ).toBe("This is **vital** content");
  });

  it("drops only the snippet on delete", () => {
    expect(composeMarkdownEdit(match, "delete", "**important**", "")).toBe(
      "This is  content",
    );
  });

  it("keeps the snippet when inserting around it", () => {
    expect(
      composeMarkdownEdit(match, "insert_before", "**important**", "NEW"),
    ).toBe("This is NEW\n\n**important** content");
    expect(
      composeMarkdownEdit(match, "insert_after", "**important**", "NEW"),
    ).toBe("This is **important**\n\nNEW content");
  });

  it("round-trips a heading without losing its level", () => {
    const headings = blocks("## Project Background", "Body");
    const m = findMarkdownMatch(headings, "## Project Background")!;
    expect(
      composeMarkdownEdit(
        m,
        "replace",
        "## Project Background",
        "## Background",
      ),
    ).toBe("## Background");
  });
});
