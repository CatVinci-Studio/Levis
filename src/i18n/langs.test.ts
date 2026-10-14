import { describe, expect, it } from "vitest";
import { detectLang, localeOf } from "./langs";

describe("detectLang", () => {
  it("reads Chinese by script, then by region", () => {
    expect(detectLang("zh-CN")).toBe("zh");
    expect(detectLang("zh")).toBe("zh");
    expect(detectLang("zh-SG")).toBe("zh");
    expect(detectLang("zh-Hans-HK")).toBe("zh");
    expect(detectLang("zh-TW")).toBe("zh-Hant");
    expect(detectLang("zh-HK")).toBe("zh-Hant");
    expect(detectLang("zh-MO")).toBe("zh-Hant");
    expect(detectLang("zh-Hant")).toBe("zh-Hant");
    expect(detectLang("zh_TW")).toBe("zh-Hant");
  });

  it("takes any region of the other languages", () => {
    expect(detectLang("ja-JP")).toBe("ja");
    expect(detectLang("ko-KR")).toBe("ko");
    expect(detectLang("es-419")).toBe("es");
    expect(detectLang("fr-CA")).toBe("fr");
    expect(detectLang("de-AT")).toBe("de");
    expect(detectLang("ru")).toBe("ru");
    expect(detectLang("pt-PT")).toBe("pt");
    expect(detectLang("en-GB")).toBe("en");
  });

  it("falls back to English", () => {
    expect(detectLang("it-IT")).toBe("en");
    expect(detectLang("")).toBe("en");
  });
});

it("gives Chinese the region that picks its glyphs", () => {
  expect(localeOf("zh")).toBe("zh-CN");
  expect(localeOf("zh-Hant")).toBe("zh-TW");
  expect(localeOf("de")).toBe("de");
});
