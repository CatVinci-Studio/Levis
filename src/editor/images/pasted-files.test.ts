import { describe, expect, it } from "vitest";
import {
  fileUrlToPath,
  imageFilesFromClipboard,
  imageMimeForPath,
} from "./pasted-files";

describe("fileUrlToPath", () => {
  it("decodes a local file URL", () => {
    expect(
      fileUrlToPath(
        "file:///home/wang/%E5%9B%BE%E7%89%87/%E6%88%AA%E5%9B%BE/a%20b.png",
      ),
    ).toBe("/home/wang/图片/截图/a b.png");
    expect(fileUrlToPath("file://localhost/tmp/x.png")).toBe("/tmp/x.png");
  });

  it("keeps a Windows drive path without the leading slash", () => {
    expect(fileUrlToPath("file:///C:/Users/me/x.png")).toBe(
      "C:/Users/me/x.png",
    );
  });

  it("refuses remote hosts and other schemes", () => {
    expect(fileUrlToPath("file://server/share/x.png")).toBeNull();
    expect(fileUrlToPath("https://x.org/x.png")).toBeNull();
    expect(fileUrlToPath("file:///bad%E0%A4%A")).toBeNull();
  });
});

describe("imageMimeForPath", () => {
  it("names image types by extension, case-insensitively", () => {
    expect(imageMimeForPath("/a/b.PNG")).toBe("image/png");
    expect(imageMimeForPath("/a/b.jpeg")).toBe("image/jpeg");
    expect(imageMimeForPath("/a/b.pdf")).toBeNull();
    expect(imageMimeForPath("/a/png")).toBeNull();
  });
});

describe("imageFilesFromClipboard", () => {
  it("reads a uri-list, skipping comments and CRLF", () => {
    expect(
      imageFilesFromClipboard({
        uriList: "# copied\r\nfile:///tmp/a.png\r\nfile:///tmp/b.jpg\r\n",
      }),
    ).toEqual(["/tmp/a.png", "/tmp/b.jpg"]);
  });

  it("reads GNOME Files' copied-files list", () => {
    expect(
      imageFilesFromClipboard({
        gnomeCopiedFiles: "copy\nfile:///home/me/shot.png",
      }),
    ).toEqual(["/home/me/shot.png"]);
  });

  it("falls back to the links the pasted HTML parsed into", () => {
    expect(
      imageFilesFromClipboard({ linkHrefs: ["file:///home/me/shot.webp"] }),
    ).toEqual(["/home/me/shot.webp"]);
  });

  it("returns nothing when anything pasted is not a local image", () => {
    expect(
      imageFilesFromClipboard({
        uriList: "file:///tmp/a.png\nfile:///tmp/doc.pdf",
      }),
    ).toEqual([]);
    expect(
      imageFilesFromClipboard({ linkHrefs: ["https://x.org/a.png"] }),
    ).toEqual([]);
    expect(imageFilesFromClipboard({ uriList: "", linkHrefs: [] })).toEqual([]);
  });
});
