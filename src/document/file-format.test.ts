import { describe, expect, it } from "vitest";
import { detectFormat, toEditorText, toFileText } from "./file-format";

describe("file format", () => {
  it("reads a Windows file as \\n and writes it back as CRLF", () => {
    const raw = "# T\r\n\r\nline\r\n";
    const format = detectFormat(raw);
    expect(format).toEqual({ crlf: true, bom: false });
    const text = toEditorText(raw);
    expect(text).toBe("# T\n\nline\n");
    expect(toFileText(text + "more\n", format)).toBe(
      "# T\r\n\r\nline\r\nmore\r\n",
    );
  });

  it("keeps a byte-order mark", () => {
    const raw = "﻿# T\n";
    const format = detectFormat(raw);
    expect(format).toEqual({ crlf: false, bom: true });
    expect(toEditorText(raw)).toBe("# T\n");
    expect(toFileText("# T\n", format)).toBe("﻿# T\n");
  });

  it("decides mixed endings by majority, and \\n without any", () => {
    expect(detectFormat("a\r\nb\r\nc\n").crlf).toBe(true);
    expect(detectFormat("a\nb\nc\r\n").crlf).toBe(false);
    expect(detectFormat("one line").crlf).toBe(false);
  });

  it("leaves a plain file byte for byte", () => {
    const raw = "# T\n\ntext\n";
    expect(toEditorText(raw)).toBe(raw);
    expect(toFileText(raw, detectFormat(raw))).toBe(raw);
  });

  it("turns a lone \\r (old Mac) into a line break", () => {
    expect(toEditorText("a\rb")).toBe("a\nb");
  });
});
