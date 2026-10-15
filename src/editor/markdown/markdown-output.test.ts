// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import type { Editor } from "@milkdown/kit/core";
import { editorViewCtx, serializerCtx } from "@milkdown/kit/core";
import { createTestEditor } from "../../document-view/editor-test-harness";

const editors: Editor[] = [];
afterEach(async () => {
  await Promise.all(editors.splice(0).map((editor) => editor.destroy()));
});

/** Opens `markdown` in the full editor chain and saves it straight back. */
async function roundTrip(markdown: string): Promise<string> {
  const editor = await createTestEditor(markdown);
  editors.push(editor);
  return editor.action((ctx) =>
    ctx.get(serializerCtx)(ctx.get(editorViewCtx).state.doc),
  );
}

describe("saved markdown stays as written", () => {
  it.each([
    ["a tight bullet list", "* 一\n* 二\n"],
    ["a loose bullet list", "* 一\n\n* 二\n"],
    ["a nested tight list", "* 一\n  * 子\n* 二\n"],
    ["a task list", "* [ ] 待办\n* [x] 完成\n"],
    ["dash bullets", "- 一\n- 二\n  - 子\n"],
    ["plus bullets", "+ a\n+ b\n"],
    ["dash task items", "- [ ] 待办\n- [x] 完成\n"],
    ["an ordered list", "1. 一\n2. 二\n"],
    ["a list starting at 3", "3. 三\n4. 四\n"],
    ["CJK bold", "中文**加粗**中文\n"],
    ["frontmatter", "---\ntitle: t\n---\n\n正文\n"],
    [
      "a <br> in a table cell",
      "| a      | b |\n| ------ | - |\n| x<br>y | z |\n",
    ],
    ["a link around inline code", "Via [`[catvinci]`](https://x.org/r) repo\n"],
    ["a link with code inside", "[see `code` here](u) after\n"],
    ["a link with math inside", "[see $x$ here](u) after\n"],
    ["inline math", "$x$ and $y_1$\n"],
    ["a GitHub alert", "> [!NOTE]\n> 提示\n"],
    ["an equals sign", "2+2=4 and a = b\n"],
    ["equals signs in a row", "x == y but not ==mark==\n"],
    ["a literal == that would open a highlight", "a \\==b== stays text\n"],
    ["a highlight", "一段==高亮==文字\n"],
    ["a footnote", "正文[^1]\n\n[^1]: 脚注\n"],
    ["an image width", '![图](a.png "{textus-width=30%}")\n'],
  ])("keeps %s", async (_name, markdown) => {
    expect(await roundTrip(markdown)).toBe(markdown);
  });

  it("escapes an alert marker that doesn't open a quote", async () => {
    expect(await roundTrip("text [!NOTE] here\n")).toBe(
      "text \\[!NOTE] here\n",
    );
  });

  it("keeps a link on a bold word inside it", async () => {
    expect(await roundTrip("[**bold** text](u) after\n")).toContain("](u)");
    expect(await roundTrip("[**bold** text](u) after\n")).toContain(
      "[text](u)",
    );
  });

  it("reads dollar amounts as text, not math (Pandoc's rule)", async () => {
    expect(await roundTrip("about $4) and round's $19 ok\n")).toBe(
      "about \\$4) and round's \\$19 ok\n",
    );
    expect(await roundTrip("costs $5 and $6\n")).toBe("costs \\$5 and \\$6\n");
    expect(await roundTrip("a $ x$ b\n")).toBe("a \\$ x\\$ b\n");
  });

  it("writes a thematic break as '---', but '***' as the first block", async () => {
    expect(await roundTrip("段\n\n***\n")).toBe("段\n\n---\n");
    expect(await roundTrip("***\n\n段\n")).toBe("***\n\n段\n");
  });
});
