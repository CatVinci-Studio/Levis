/// Shared key-combo helpers. Combos are stored/compared as normalized
/// strings like "mod+shift+g" - "mod" stands for Cmd on macOS and Ctrl
/// everywhere else, so the same stored string works cross-platform.
const MODIFIER_KEYS = new Set(["control", "meta", "alt", "shift"]);

function isMac(): boolean {
  return /mac/i.test(navigator.platform || navigator.userAgent);
}

/// Builds a normalized combo string from a KeyboardEvent. Returns null while
/// only modifier keys are held (not a complete, bindable combo yet).
export function comboFromEvent(e: KeyboardEvent): string | null {
  const key = e.key.toLowerCase();
  if (MODIFIER_KEYS.has(key)) return null;

  const parts: string[] = [];
  if (e.metaKey || e.ctrlKey) parts.push("mod");
  if (e.altKey) parts.push("alt");
  if (e.shiftKey) parts.push("shift");
  parts.push(key === " " ? "space" : key);
  return parts.join("+");
}

/// Whether a captured combo is safe to bind - requires at least one
/// modifier so it can't shadow normal typing.
export function isBindableCombo(combo: string): boolean {
  return combo.includes("+");
}

const KEY_LABELS: Record<string, string> = {
  space: "Space",
  arrowup: "↑",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
  escape: "Esc",
};

/// Renders a stored combo string for display, e.g. "mod+shift+g" -> "⌘⇧G" on
/// macOS or "Ctrl+Shift+G" elsewhere.
export function formatCombo(combo: string): string {
  const mac = isMac();
  return combo
    .split("+")
    .map((part) => {
      if (part === "mod") return mac ? "⌘" : "Ctrl";
      if (part === "alt") return mac ? "⌥" : "Alt";
      if (part === "shift") return mac ? "⇧" : "Shift";
      return KEY_LABELS[part] ?? part.toUpperCase();
    })
    .join(mac ? "" : "+");
}
