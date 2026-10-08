import { describe, expect, it } from "vitest";
import { adaptTyporaCss } from "./typora-compat";

describe("adaptTyporaCss", () => {
  it("maps thead selectors onto the header row", () => {
    expect(adaptTyporaCss("#write thead th { color: red }")).toBe(
      "#write tr[data-is-header] th { color: red }",
    );
    expect(adaptTyporaCss("table thead > tr { x: y }")).toBe(
      "table tr[data-is-header] { x: y }",
    );
    expect(adaptTyporaCss("thead tr th, thead { x: y }")).toBe(
      "tr[data-is-header] th, tr[data-is-header] { x: y }",
    );
  });

  it("leaves unrelated selectors alone", () => {
    const css = "#write .theader, tbody tr:nth-child(2n) { x: y }";
    expect(adaptTyporaCss(css)).toBe(css);
  });
});
