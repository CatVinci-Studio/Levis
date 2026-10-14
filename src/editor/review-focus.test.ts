import { describe, expect, it } from "vitest";
import {
  editorFocusedBeforeAction,
  PRESS_WINDOW_MS,
  refocusAfterReview,
} from "./review-focus";

const base = {
  phone: false,
  ios: false,
  editorHadFocus: false,
  textFieldFocused: false,
};

describe("refocusAfterReview", () => {
  it("always refocuses on the desktop, outside a text field", () => {
    expect(refocusAfterReview(base)).toBe(true);
    expect(refocusAfterReview({ ...base, editorHadFocus: true })).toBe(true);
    expect(refocusAfterReview({ ...base, textFieldFocused: true })).toBe(false);
  });

  it("never refocuses on a phone", () => {
    for (const editorHadFocus of [false, true])
      expect(
        refocusAfterReview({ ...base, phone: true, ios: true, editorHadFocus }),
      ).toBe(false);
  });

  it("refocuses on an iPad only when the user was typing in the document", () => {
    // No keyboard up, a tap on Accept or Next: leave the focus alone, or
    // the software keyboard rises over the document after every step.
    expect(refocusAfterReview({ ...base, ios: true })).toBe(false);
    // Typing (a hardware keyboard, or the software one already up): the
    // caret goes back, as on the desktop.
    expect(
      refocusAfterReview({ ...base, ios: true, editorHadFocus: true }),
    ).toBe(true);
    expect(
      refocusAfterReview({
        ...base,
        ios: true,
        editorHadFocus: true,
        textFieldFocused: true,
      }),
    ).toBe(false);
  });
});

describe("editorFocusedBeforeAction", () => {
  it("counts focus now, or at the press that started the action", () => {
    expect(editorFocusedBeforeAction(true, null, 0)).toBe(true);
    expect(editorFocusedBeforeAction(false, null, 0)).toBe(false);
    // The tap moved the focus off the editor before its click ran.
    expect(
      editorFocusedBeforeAction(false, { focused: true, at: 1000 }, 1100),
    ).toBe(true);
    expect(
      editorFocusedBeforeAction(false, { focused: false, at: 1000 }, 1100),
    ).toBe(false);
  });

  it("ignores a press from long before", () => {
    expect(
      editorFocusedBeforeAction(
        false,
        { focused: true, at: 1000 },
        1000 + PRESS_WINDOW_MS,
      ),
    ).toBe(false);
  });
});
