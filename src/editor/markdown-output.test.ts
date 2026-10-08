// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import type { Editor } from "@milkdown/kit/core";
import { editorViewCtx, serializerCtx } from "@milkdown/kit/core";
import { createTestEditor } from "./editor-test-harness";

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
    ["an ordered list", "1. 一\n2. 二\n"],
    ["a list starting at 3", "3. 三\n4. 四\n"],
    ["CJK bold", "中文**加粗**中文\n"],
    ["frontmatter", "---\ntitle: t\n---\n\n正文\n"],
    [
      "a <br> in a table cell",
      "| a      | b |\n| ------ | - |\n| x<br>y | z |\n",
    ],
  ])("keeps %s", async (_name, markdown) => {
    expect(await roundTrip(markdown)).toBe(markdown);
  });

  it("writes a thematic break as '---', but '***' as the first block", async () => {
    expect(await roundTrip("段\n\n***\n")).toBe("段\n\n---\n");
    expect(await roundTrip("***\n\n段\n")).toBe("***\n\n段\n");
  });
});
