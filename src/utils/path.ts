// OS-path string math shared across the frontend. A path may use either
// separator - documents opened on Windows arrive with "\" while everything
// else uses "/" - so both are treated as separators here (see commit
// 030e9a2). Note theme-import.ts keeps its own dirnameOf: it needs ""
// (not the input) for a separator-less path, feeding its resolvePath.

export function basename(path: string): string {
  const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return idx >= 0 ? path.slice(idx + 1) : path;
}

// Returns the input unchanged when there is no parent to strip (a bare
// filename, or a root-level "/name").
export function dirname(path: string): string {
  const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return idx > 0 ? path.slice(0, idx) : path;
}
