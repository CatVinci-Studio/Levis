import { describe, expect, it } from "vitest";
import { Schema } from "@milkdown/kit/prose/model";
import { EditorState, TextSelection } from "@milkdown/kit/prose/state";
import { Decoration } from "@milkdown/kit/prose/view";
import { applyReveal, buildReveal, type RevealState } from "./reveal-state";

const schema = new Schema({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: { content: "text*" },
    text: {},
  },
});

// "hello world" in one paragraph: positions 1..12. The watched range is
// "world" (7..12); a decoration exists only while the caret is away.
const doc = schema.node("doc", null, [
  schema.node("paragraph", null, schema.text("hello world")),
]);
let builds = 0;
const build = (state: EditorState): RevealState => {
  builds++;
  return buildReveal(state, (touches) =>
    touches(7, 12) ? [] : [Decoration.inline(7, 12, { class: "x" })],
  );
};

function at(pos: number) {
  const state = EditorState.create({ doc, selection: undefined });
  return state.apply(
    state.tr.setSelection(TextSelection.create(state.doc, pos)),
  );
}

function move(from: number, to: number) {
  const before = at(from);
  const prev = build(before);
  const tr = before.tr.setSelection(TextSelection.create(before.doc, to));
  builds = 0;
  const next = applyReveal(tr, prev, before, before.apply(tr), build);
  return { prev, next, rebuilt: builds > 0 };
}

describe("applyReveal", () => {
  it("keeps the set when a caret move flips no watched range", () => {
    const { prev, next, rebuilt } = move(1, 3);
    expect(rebuilt).toBe(false);
    expect(next).toBe(prev);
  });

  it("rebuilds when the caret reaches a watched range", () => {
    const { next, rebuilt } = move(2, 8);
    expect(rebuilt).toBe(true);
    expect(next.set.find()).toHaveLength(0);
  });

  it("rebuilds when the caret leaves a watched range", () => {
    const { next, rebuilt } = move(9, 2);
    expect(rebuilt).toBe(true);
    expect(next.set.find()).toHaveLength(1);
  });

  it("always rebuilds on a doc change", () => {
    const before = at(1);
    const prev = build(before);
    const tr = before.tr.insertText("!", 1);
    builds = 0;
    applyReveal(tr, prev, before, before.apply(tr), build);
    expect(builds).toBe(1);
  });
});
