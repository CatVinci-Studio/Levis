#!/usr/bin/env node
// The in-app updater's manifest, and the guard that keeps Textus releases
// away from Levis installs.
//
// Levis (com.chengaoshen.levis, 0.9.x) polls
//   github.com/CatVinci-Studio/Levis/releases/latest/download/latest.json
// and the repository rename to CatVinci-Studio/Textus redirects that URL to
// this repository. Textus is signed with the same updater key, so a
// `latest.json` on a Textus release would be downloaded, verified and
// installed over Levis.app by every Levis install. Textus therefore never
// publishes a file of that name: its manifest is `textus-latest.json`,
// written here from the draft release's signed artifacts (tauri-action runs
// with includeUpdaterJson: false), and the release workflow refuses to
// publish a draft that carries a `latest.json`.
//
//   node scripts/updater-manifest.mjs check [--root DIR]
//       tauri.conf.json's updater endpoints name textus-latest.json and
//       release.yml keeps tauri-action from uploading latest.json (exit 1
//       otherwise)
//   node scripts/updater-manifest.mjs build --version V --base-url URL
//       --sig-dir DIR [--notes-file F] --out FILE
//       the manifest for the .sig files downloaded into DIR; each artifact's
//       URL is BASE-URL/<its name> (the .sig's name minus ".sig")
//   node scripts/updater-manifest.mjs guard --assets-file FILE
//       FILE lists a release's asset names, one per line; exit 1 if one is a
//       manifest name Levis reads
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** What Textus's updater reads and the release workflow uploads. */
export const MANIFEST_NAME = "textus-latest.json";
/** What Levis's updater reads. Never an asset of a Textus release. */
export const LEVIS_MANIFEST_NAME = "latest.json";

const ownRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Problems with the updater wiring in a checkout, one line each. */
export function configProblems(readFile) {
  const problems = [];
  const conf = JSON.parse(readFile("src-tauri/tauri.conf.json"));
  const endpoints = conf.plugins?.updater?.endpoints ?? [];
  if (endpoints.length === 0)
    problems.push("tauri.conf.json: no updater endpoints");
  for (const url of endpoints) {
    const file = url.split("/").pop();
    if (file !== MANIFEST_NAME)
      problems.push(
        `tauri.conf.json: updater endpoint ${url} must end in /${MANIFEST_NAME}`,
      );
  }
  const workflow = readFile(".github/workflows/release.yml");
  if (!/^\s*includeUpdaterJson:\s*false\s*$/m.test(workflow))
    problems.push(
      `release.yml: tauri-action must run with includeUpdaterJson: false (it uploads ${LEVIS_MANIFEST_NAME} otherwise)`,
    );
  return problems;
}

/** The updater platform keys an artifact serves, by its asset name. The
 *  plain `<os>-<arch>` key is the default installer for that platform;
 *  `<os>-<arch>-<installer>` lets an install that came from a .deb or .rpm
 *  stay on that format (tauri-plugin-updater tries the longer key first). */
export function platformKeys(name) {
  if (/\.app\.tar\.gz$/.test(name)) {
    if (/aarch64|arm64/.test(name))
      return ["darwin-aarch64", "darwin-aarch64-app"];
    if (/x64|x86_64/.test(name)) return ["darwin-x86_64", "darwin-x86_64-app"];
    return [];
  }
  if (/\.AppImage$/.test(name))
    return ["linux-x86_64", "linux-x86_64-appimage"];
  if (/\.deb$/.test(name)) return ["linux-x86_64-deb"];
  if (/\.rpm$/.test(name)) return ["linux-x86_64-rpm"];
  if (/-setup\.exe$/.test(name))
    return ["windows-x86_64", "windows-x86_64-nsis"];
  return [];
}

/** The manifest for `artifacts` ({ name, signature }), in the format
 *  tauri-plugin-updater reads. */
export function buildManifest({ version, notes, pubDate, baseUrl, artifacts }) {
  const platforms = {};
  for (const { name, signature } of artifacts) {
    for (const key of platformKeys(name)) {
      if (platforms[key]) throw new Error(`two artifacts serve ${key}`);
      platforms[key] = {
        signature: signature.trim(),
        url: `${baseUrl.replace(/\/$/, "")}/${encodeURIComponent(name)}`,
      };
    }
  }
  return { version, notes, pub_date: pubDate, platforms };
}

/** Platforms every release must serve. */
export const REQUIRED_PLATFORMS = [
  "darwin-aarch64",
  "linux-x86_64",
  "windows-x86_64",
];

export function manifestProblems(manifest, version) {
  const problems = [];
  if (manifest.version !== version)
    problems.push(`manifest says ${manifest.version}, expected ${version}`);
  for (const key of REQUIRED_PLATFORMS) {
    const entry = manifest.platforms[key];
    if (!entry?.url || !entry?.signature)
      problems.push(`no signed ${key} entry`);
  }
  return problems;
}

/** Asset names a Textus release must not carry. */
export function forbiddenAssets(names) {
  return names.filter((name) => name.trim() === LEVIS_MANIFEST_NAME);
}

function fail(lines) {
  for (const line of lines) console.error(`::error::${line}`);
  process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2);
  const option = (name) => {
    const at = args.indexOf(name);
    if (at < 0) return undefined;
    if (!args[at + 1]) fail([`${name} needs a value`]);
    return args[at + 1];
  };
  const required = (name) => option(name) ?? fail([`${name} is required`]);

  if (command === "check") {
    const root = option("--root") ?? ownRoot;
    const problems = configProblems((file) =>
      readFileSync(join(root, file), "utf8"),
    );
    if (problems.length > 0) fail(problems);
  } else if (command === "build") {
    const version = required("--version");
    const sigDir = required("--sig-dir");
    const notesFile = option("--notes-file");
    const artifacts = readdirSync(sigDir)
      .filter((file) => file.endsWith(".sig"))
      .map((file) => ({
        name: file.slice(0, -".sig".length),
        signature: readFileSync(join(sigDir, file), "utf8"),
      }));
    const manifest = buildManifest({
      version,
      notes: notesFile ? readFileSync(notesFile, "utf8") : "",
      pubDate: new Date().toISOString(),
      baseUrl: required("--base-url"),
      artifacts,
    });
    const problems = manifestProblems(manifest, version);
    if (problems.length > 0) fail(problems);
    writeFileSync(required("--out"), `${JSON.stringify(manifest, null, 2)}\n`);
  } else if (command === "guard") {
    const names = readFileSync(required("--assets-file"), "utf8").split("\n");
    const bad = forbiddenAssets(names);
    if (bad.length > 0)
      fail([
        `this release carries ${LEVIS_MANIFEST_NAME}: every Levis install would read it and install Textus over itself. Delete the asset; Textus's manifest is ${MANIFEST_NAME}.`,
      ]);
  } else {
    fail([`unknown command ${command ?? "(none)"}: check, build or guard`]);
  }
}
