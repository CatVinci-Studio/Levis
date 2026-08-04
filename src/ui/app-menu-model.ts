import type { Strings } from "../i18n/strings";
import type { Shortcuts } from "../settings/SettingsContext";
import { basename } from "../utils/path";

/**
 * The app menu, as data - what `AppMenu.tsx` draws where the app owns its
 * window frame and there is no native menu bar left (Windows; see
 * ui/window-chrome.ts).
 *
 * Every entry that reaches the backend carries the SAME id its native twin
 * in src-tauri/src/menu.rs was built with, and `trigger_menu_item` there
 * runs it through the one dispatch the native click path uses. So the ids
 * are the contract between the two files: labels, order and grouping are
 * this file's business, behaviour is menu.rs's, and neither can quietly
 * change the other.
 *
 * The layout deliberately does NOT mirror the macOS menu bar. It is the one
 * Windows apps use: no application submenu (About lives in Settings, where
 * the version and update check already are), no Window submenu (New Window
 * belongs in File, and minimise/maximise are the caption buttons two
 * centimetres to the right), and Settings/Exit sit at the root of the
 * popover the way Edge's and VS Code's do.
 */

/** Menu ids that exist natively (src-tauri/src/menu.rs) - listed here so a
 *  typo is a compile error rather than an item that silently does nothing. */
type NativeMenuId =
  | "settings"
  | "new-file"
  | "new-window"
  | "open-file"
  | "recent-clear"
  | "save-file"
  | "save-file-as"
  | "export-pdf"
  | "export-html"
  | "close-tab"
  | "close-window"
  | "quit"
  | "find-replace"
  | "toggle-source-mode"
  | "toggle-typewriter-mode"
  | "toggle-sidebar"
  | "zoom-in"
  | "zoom-out"
  | "zoom-reset"
  | `recent:${string}`
  | `export-pandoc:${string}`
  | `insert-block:${string}`
  | `help-doc:${string}`;

/**
 * The handful of items with no native id to send.
 *
 * They were `PredefinedMenuItem`s in the native menu - muda generates their
 * ids, so there is nothing stable to address them by, and no API to fire one
 * from outside a click. The frontend already implements every one of them
 * (the editor's own clipboard helpers, prosemirror history, the window API),
 * so the app-drawn menu calls that directly instead.
 */
export type LocalMenuAction =
  "undo" | "redo" | "cut" | "copy" | "paste" | "select-all" | "fullscreen";

export type MenuAction = { native: NativeMenuId } | { local: LocalMenuAction };

export interface MenuEntry {
  label: string;
  /** A stored combo string ("mod+shift+s"), rendered with formatCombo. Only
   *  set it where the combo really is bound - a hint for a shortcut that
   *  does nothing is worse than no hint. */
  accel?: string;
  /** Native tooltip, for entries whose label had to be shortened. */
  title?: string;
  action?: MenuAction;
  submenu?: MenuNode[];
  disabled?: boolean;
}

export type MenuNode = MenuEntry | "separator";

/** Recent files are listed by name, with the full path on hover - a Windows
 *  home directory eats most of the width of `C:\Users\...\notes.md`, and two
 *  files can share a name. */
function recentEntries(t: Strings, recents: string[]): MenuNode[] {
  if (recents.length === 0) {
    return [{ label: t.menuRecentNone, disabled: true }];
  }
  return [
    ...recents.map((path): MenuNode => ({
      label: basename(path) || path,
      title: path,
      action: { native: `recent:${path}` },
    })),
    "separator",
    { label: t.menuRecentClear, action: { native: "recent-clear" } },
  ];
}

/** Same format list, in the same order, as menu.rs's EXPORT_PANDOC_PREFIX
 *  loop and the frontend's PANDOC_FORMATS (src/export-doc.ts). */
function exportEntries(t: Strings): MenuNode[] {
  const pandoc: [string, string][] = [
    ["docx", t.menuExportDocx],
    ["odt", t.menuExportOdt],
    ["rtf", t.menuExportRtf],
    ["epub", t.menuExportEpub],
    ["latex", t.menuExportLatex],
    ["mediawiki", t.menuExportMediawiki],
    ["rst", t.menuExportRst],
    ["textile", t.menuExportTextile],
    ["opml", t.menuExportOpml],
  ];
  return [
    {
      label: t.menuExportPdf,
      accel: "mod+p",
      action: { native: "export-pdf" },
    },
    { label: t.menuExportHtml, action: { native: "export-html" } },
    "separator",
    ...pandoc.map(([format, label]): MenuNode => ({
      label,
      action: { native: `export-pandoc:${format}` },
    })),
  ];
}

function formatEntries(t: Strings): MenuNode[] {
  const headings = [1, 2, 3, 4, 5, 6].map((level): MenuNode => ({
    label: t.menuHeadingTemplate.replace("{n}", String(level)),
    action: { native: `insert-block:h${level}` },
  }));
  const blocks: [string, string][] = [
    ["bullet-list", t.menuBulletList],
    ["ordered-list", t.menuOrderedList],
    ["blockquote", t.menuBlockquote],
    ["code-block", t.menuCodeBlock],
    ["table", t.menuTable],
  ];
  return [
    ...headings,
    "separator",
    ...blocks.map(([kind, label]): MenuNode => ({
      label,
      action: { native: `insert-block:${kind}` },
    })),
  ];
}

export function buildAppMenu(
  t: Strings,
  shortcuts: Shortcuts,
  recents: string[],
): MenuNode[] {
  return [
    {
      label: t.menuFile,
      submenu: [
        {
          label: t.menuNewFile,
          accel: "mod+n",
          action: { native: "new-file" },
        },
        {
          // Ctrl+Shift+N, not the Cmd+T this has on macOS: Ctrl+T is "new
          // tab" to a Windows user and this app has tabs. Bound to match in
          // menu.rs (NEW_WINDOW_ACCEL).
          label: t.menuNewWindow,
          accel: "mod+shift+n",
          action: { native: "new-window" },
        },
        {
          label: t.menuOpenFile,
          accel: "mod+o",
          action: { native: "open-file" },
        },
        { label: t.menuOpenRecent, submenu: recentEntries(t, recents) },
        "separator",
        { label: t.menuSave, accel: "mod+s", action: { native: "save-file" } },
        {
          label: t.menuSaveAs,
          accel: "mod+shift+s",
          action: { native: "save-file-as" },
        },
        { label: t.menuExport, submenu: exportEntries(t) },
        "separator",
        {
          label: t.menuCloseTab,
          accel: "mod+w",
          action: { native: "close-tab" },
        },
        {
          label: t.menuCloseWindow,
          accel: "mod+shift+w",
          action: { native: "close-window" },
        },
      ],
    },
    {
      label: t.menuEdit,
      submenu: [
        { label: t.menuUndo, accel: "mod+z", action: { local: "undo" } },
        // Ctrl+Y is the redo Windows advertises; milkdown's history keymap
        // binds "Mod-y" alongside "Shift-Mod-z", so both really work and this
        // shows the one the platform expects.
        { label: t.menuRedo, accel: "mod+y", action: { local: "redo" } },
        "separator",
        { label: t.cut, accel: "mod+x", action: { local: "cut" } },
        { label: t.copy, accel: "mod+c", action: { local: "copy" } },
        { label: t.paste, accel: "mod+v", action: { local: "paste" } },
        { label: t.selectAll, accel: "mod+a", action: { local: "select-all" } },
        "separator",
        {
          label: t.menuFindReplace,
          accel: shortcuts.findReplace,
          action: { native: "find-replace" },
        },
      ],
    },
    { label: t.menuFormat, submenu: formatEntries(t) },
    {
      label: t.menuView,
      submenu: [
        {
          label: t.menuToggleSourceMode,
          accel: shortcuts.toggleSourceMode,
          action: { native: "toggle-source-mode" },
        },
        {
          label: t.menuToggleTypewriterMode,
          accel: shortcuts.toggleTypewriterMode,
          action: { native: "toggle-typewriter-mode" },
        },
        {
          label: t.menuToggleSidebar,
          accel: shortcuts.toggleSidebar,
          action: { native: "toggle-sidebar" },
        },
        "separator",
        { label: t.menuZoomIn, accel: "mod+=", action: { native: "zoom-in" } },
        {
          label: t.menuZoomOut,
          accel: "mod+-",
          action: { native: "zoom-out" },
        },
        {
          label: t.menuZoomReset,
          accel: "mod+0",
          action: { native: "zoom-reset" },
        },
        "separator",
        // muda's predefined fullscreen item is documented as unsupported on
        // Windows, which is why this runs the window API here instead of
        // dispatching a menu id. F11 is bound to the same action by App.tsx's
        // keydown handler rather than by a native accelerator, for the same
        // reason - there is no native item to hang one on.
        {
          label: t.menuFullscreen,
          accel: "f11",
          action: { local: "fullscreen" },
        },
      ],
    },
    {
      label: t.menuHelp,
      submenu: [
        {
          label: t.menuHelpWelcome,
          action: { native: "help-doc:welcome" },
        },
        "separator",
        { label: t.menuHelpMarkdown, action: { native: "help-doc:markdown" } },
        { label: t.menuHelpAgent, action: { native: "help-doc:agent" } },
      ],
    },
    "separator",
    { label: t.menuSettings, accel: "mod+,", action: { native: "settings" } },
    // Alt+F4, not the Cmd+Q this has on macOS - Ctrl+Q closes nothing on
    // Windows and menu.rs deliberately no longer registers it. The hint is
    // the OS's own: Alt+F4 closes the focused window, which for the usual
    // single window is exactly this item; with several windows open this
    // one closes them all and Alt+F4 closes the front one.
    { label: t.menuExit, accel: "alt+f4", action: { native: "quit" } },
  ];
}
