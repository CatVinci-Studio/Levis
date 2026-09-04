/// Shared key-combo helpers. Combos are stored/compared as normalized
/// strings like "mod+shift+g" - "mod" stands for Cmd on macOS and Ctrl
/// everywhere else, so the same stored string works cross-platform.
import { isMacPlatform } from "./platform";
const MODIFIER_KEYS = new Set(["control", "meta", "alt", "shift", "altgraph"]);

/// Builds a normalized combo string from a KeyboardEvent. Returns null while
/// only modifier keys are held (not a complete, bindable combo yet).
export function comboFromEvent(e: KeyboardEvent): string | null {
  if (e.isComposing || e.keyCode === 229 || e.getModifierState("AltGraph"))
    return null;
  const key = e.key.toLowerCase();
  if (MODIFIER_KEYS.has(key)) return null;

  const parts: string[] = [];
  const mac = isMacPlatform();
  if (mac ? e.metaKey : e.ctrlKey) parts.push("mod");
  if (mac && e.ctrlKey) parts.push("ctrl");
  if (!mac && e.metaKey) parts.push("meta");
  if (e.altKey) parts.push("alt");
  if (e.shiftKey) parts.push("shift");
  parts.push(key === " " ? "space" : key);
  return parts.join("+");
}

/// Whether a captured combo is safe to bind - requires at least one
/// modifier so it can't shadow normal typing.
export function isBindableCombo(combo: string): boolean {
  return /^(?:mod|ctrl|meta|alt)\+/.test(combo);
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
  const mac = isMacPlatform();
  return combo
    .split("+")
    .map((part) => {
      if (part === "mod") return mac ? "⌘" : "Ctrl";
      if (part === "ctrl") return mac ? "⌃" : "Ctrl";
      if (part === "meta") return mac ? "⌘" : "Win";
      if (part === "alt") return mac ? "⌥" : "Alt";
      if (part === "shift") return mac ? "⇧" : "Shift";
      return KEY_LABELS[part] ?? part.toUpperCase();
    })
    .join(mac ? "" : "+");
}

// These combinations are owned by the app/native menu, before user bindings.
const RESERVED_COMBOS = new Set([
  "mod+p",
  "mod+=",
  "mod+-",
  "mod+0",
  "mod+s",
  "mod+shift+s",
  "mod+n",
  "mod+o",
  "mod+w",
  "mod+shift+w",
  "mod+q",
  "mod+,",
  "mod+z",
  "mod+shift+z",
  "mod+y",
  "mod+a",
  "mod+c",
  "mod+x",
  "mod+v",
  "mod+b",
  "mod+i",
  "mod+arrowleft",
  "mod+arrowright",
  "mod+arrowup",
  "mod+arrowdown",
  "mod+shift+arrowleft",
  "mod+shift+arrowright",
  "mod+shift+arrowup",
  "mod+shift+arrowdown",
]);
export function isReservedCombo(combo: string): boolean {
  return (
    RESERVED_COMBOS.has(combo) ||
    (isMacPlatform()
      ? combo === "mod+t"
      : combo === "mod+shift+n" || combo === "alt+f4")
  );
}
