import { describe, expect, it } from "vitest";
import { isInside, parentDir } from "./path";

describe("parentDir", () => {
  it("steps up on POSIX and Windows paths", () => {
    expect(parentDir("/home/me/notes")).toBe("/home/me");
    expect(parentDir("/home")).toBe("/");
    expect(parentDir("/home/me/")).toBe("/home");
    expect(parentDir("C:\\Users\\me")).toBe("C:\\Users");
    expect(parentDir("C:\\Users")).toBe("C:\\");
  });
  it("stops at a root", () => {
    expect(parentDir("/")).toBeNull();
    expect(parentDir("C:\\")).toBeNull();
    expect(parentDir("\\\\server\\share")).toBeNull();
  });
});

describe("isInside", () => {
  it("matches only whole path segments below the folder", () => {
    expect(isInside("/a/b/c.md", "/a")).toBe(true);
    expect(isInside("/a/b/c.md", "/")).toBe(true);
    expect(isInside("C:\\a\\c.md", "C:\\")).toBe(true);
    expect(isInside("/ab/c.md", "/a")).toBe(false);
    expect(isInside("/a", "/a")).toBe(false);
  });
});
