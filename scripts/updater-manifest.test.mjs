import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildManifest,
  configProblems,
  forbiddenAssets,
  manifestProblems,
  MANIFEST_NAME,
} from "./updater-manifest.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const readRepo = (file) => readFileSync(join(root, file), "utf8");

describe("updater manifest", () => {
  it("this checkout reads textus-latest.json and never uploads latest.json", () => {
    expect(configProblems(readRepo)).toEqual([]);
  });

  it("rejects an endpoint that Levis also reads", () => {
    const conf = JSON.parse(readRepo("src-tauri/tauri.conf.json"));
    conf.plugins.updater.endpoints = [
      "https://github.com/CatVinci-Studio/Textus/releases/latest/download/latest.json",
    ];
    const problems = configProblems((file) =>
      file.endsWith("tauri.conf.json") ? JSON.stringify(conf) : readRepo(file),
    );
    expect(problems.join("\n")).toMatch(/must end in \/textus-latest\.json/);
  });

  it("rejects a release workflow that lets tauri-action upload latest.json", () => {
    const problems = configProblems((file) =>
      file.endsWith("release.yml")
        ? readRepo(file).replace(/includeUpdaterJson: false/, "")
        : readRepo(file),
    );
    expect(problems.join("\n")).toMatch(/includeUpdaterJson: false/);
  });

  it("flags latest.json among a release's assets, and nothing else", () => {
    expect(
      forbiddenAssets([MANIFEST_NAME, "Textus_1.0.0_x64-setup.exe", ""]),
    ).toEqual([]);
    expect(forbiddenAssets(["latest.json", MANIFEST_NAME])).toEqual([
      "latest.json",
    ]);
  });

  it("builds every platform's entry from the signed artifacts", () => {
    const manifest = buildManifest({
      version: "1.0.0",
      notes: "notes",
      pubDate: "2026-10-14T00:00:00.000Z",
      baseUrl:
        "https://github.com/CatVinci-Studio/Textus/releases/download/v1.0.0/",
      artifacts: [
        { name: "Textus_aarch64.app.tar.gz", signature: "mac\n" },
        { name: "Textus_1.0.0_amd64.AppImage", signature: "appimage" },
        { name: "Textus_1.0.0_amd64.deb", signature: "deb" },
        { name: "Textus_1.0.0_x64-setup.exe", signature: "nsis" },
        { name: "textus-1.0.0-x86_64.tar.gz", signature: "ignored" },
      ],
    });
    expect(manifest.platforms["darwin-aarch64"]).toEqual({
      signature: "mac",
      url: "https://github.com/CatVinci-Studio/Textus/releases/download/v1.0.0/Textus_aarch64.app.tar.gz",
    });
    expect(manifest.platforms["linux-x86_64"].signature).toBe("appimage");
    expect(manifest.platforms["linux-x86_64-deb"].signature).toBe("deb");
    expect(manifest.platforms["windows-x86_64-nsis"].signature).toBe("nsis");
    expect(Object.keys(manifest.platforms)).toHaveLength(7);
    expect(manifestProblems(manifest, "1.0.0")).toEqual([]);
  });

  it("reports a missing platform or a version that is not the tag's", () => {
    const manifest = buildManifest({
      version: "1.0.0",
      notes: "",
      pubDate: "",
      baseUrl: "https://example.invalid",
      artifacts: [{ name: "Textus_1.0.0_x64-setup.exe", signature: "s" }],
    });
    expect(manifestProblems(manifest, "1.0.1")).toEqual([
      "manifest says 1.0.0, expected 1.0.1",
      "no signed darwin-aarch64 entry",
      "no signed linux-x86_64 entry",
    ]);
  });
});
