import { distribution } from "../ipc";

let cached: Promise<boolean> | null = null;

/**
 * Whether this build may download and install its own updates. Only the
 * `direct` channel may: for a package-manager install (AUR, Homebrew) the
 * package manager owns the files, so the app only reports a new version.
 * A failed lookup (the dev browser shim answers null) counts as `direct`,
 * the same default the Rust side uses.
 */
export function selfUpdateAllowed(): Promise<boolean> {
  cached ??= distribution
    .appDistribution()
    .then((d) => (d ?? "direct") === "direct")
    .catch(() => true);
  return cached;
}
