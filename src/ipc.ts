import { Channel, invoke } from "@tauri-apps/api/core";
import type { ChatHandoff, ChatHandoffState } from "./ai/chat/chat-bridge";
import type { DetachedTabDoc, HelpDoc } from "./doc-tabs";
import type { DirEntryInfo } from "./sidebar/types";
import type { ProviderCatalogEntry } from "./ai/provider-catalog";
import type {
  AgentSkill,
  AgentTurn,
  ChatAttachment,
  ImageAttachment,
} from "./ai/types";
import type { GrammarIssue } from "./ai/grammar-check-plugin";
import { isDesktopApp, isIOSApp } from "./platform/capabilities";
import { iosFiles, isScopedUrl, newDocumentPath } from "./platform/ios-files";

/**
 * Thin, typed wrappers around every Tauri command the frontend calls -
 * command names and their argument/return shapes live here once instead of
 * being repeated (and occasionally drifting) at each call site. This layer
 * intentionally does not change behavior: it's the same `invoke()` calls,
 * just typed and funneled through one error shape.
 *
 * Grouped by domain (fs, session, window, export, themes, auth, ai, cli) to
 * match the Rust command modules in src-tauri/src/.
 */

/** Wraps a rejected `invoke()` with the command name that failed, so a
 *  caught error can be logged/displayed without losing which call it was. */
export class IpcError extends Error {
  readonly command: string;
  readonly cause: unknown;
  constructor(command: string, cause: unknown) {
    super(
      `${command}: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    this.name = "IpcError";
    this.command = command;
    this.cause = cause;
  }
}

async function call<T>(command: string, args?: object): Promise<T> {
  try {
    return await invoke<T>(
      command,
      args as Record<string, unknown> | undefined,
    );
  } catch (err) {
    throw new IpcError(command, err);
  }
}

/**
 * Commands that exist on desktop only - registered under `#[cfg(desktop)]`
 * in src-tauri/src/lib.rs, so on iOS there is nothing to call.
 *
 * Call sites already avoid these on iOS through src/platform/capabilities.ts;
 * this is the backstop that keeps a missed call site from reaching Rust.
 * `desktopQuery` answers with what the command would report when there is
 * nothing to report (no pending tab, no chat window, no windows) - safe for
 * reads and fire-and-forget bookkeeping. `desktopAction` rejects, for calls
 * whose caller needs to know nothing happened.
 */
function desktopQuery<T>(
  command: string,
  fallback: T,
  args?: object,
): Promise<T> {
  return isDesktopApp ? call<T>(command, args) : Promise.resolve(fallback);
}

function desktopAction<T>(command: string, args?: object): Promise<T> {
  return isDesktopApp
    ? call<T>(command, args)
    : Promise.reject(
        new IpcError(command, new Error("not available on this platform")),
      );
}

// ---------------------------------------------------------------------------
// fs (src-tauri/src/commands/fs.rs)
// ---------------------------------------------------------------------------

export interface SavedImage {
  src: string;
}

export interface ImageMigration {
  old: string;
  /** New "assets/<name>" relative src on success; null if this one image
   *  failed to migrate (left at its old absolute path). */
  new: string | null;
}

export const fs = {
  // On iOS a picked document is a file:// URL read and written through the
  // native plugin (platform/ios-files.ts); sandbox paths and every desktop
  // path go to Rust as before.
  openFileDialog: (): Promise<string | null> =>
    isIOSApp
      ? iosFiles.pickDocument()
      : call<string | null>("open_file_dialog"),
  openCssFileDialog: () => call<string | null>("open_css_file_dialog"),
  saveFileDialog: (defaultName: string): Promise<string | null> =>
    isIOSApp
      ? newDocumentPath(
          defaultName,
          async (path) =>
            (await call<number | null>("file_mtime_ms", { path })) !== null,
        )
      : call<string | null>("save_file_dialog", { defaultName }),
  listDir: (path: string): Promise<DirEntryInfo[]> =>
    isScopedUrl(path)
      ? iosFiles.listFolder(path)
      : call<DirEntryInfo[]>("list_dir", { path }),
  // No change watching for picked documents: the coordinator serialises
  // our writes with iCloud's, and the app re-reads on open.
  fileMtimeMs: (path: string): Promise<number | null> =>
    isScopedUrl(path)
      ? Promise.resolve(null)
      : call<number | null>("file_mtime_ms", { path }),
  readTextFile: (path: string): Promise<string> =>
    isScopedUrl(path)
      ? iosFiles.readText(path)
      : call<string>("read_text_file", { path }),
  readBinaryFileBase64: (path: string) =>
    call<string>("read_binary_file_base64", { path }),
  savePastedImage: (docPath: string | null, dataBase64: string, ext: string) =>
    call<SavedImage>("save_pasted_image", { docPath, dataBase64, ext }),
  uploadImage: (
    dataBase64: string,
    mime: string,
    filename: string,
    endpoint: string,
    urlField: string,
  ) =>
    call<SavedImage>("upload_image", {
      dataBase64,
      mime,
      filename,
      endpoint,
      urlField,
    }),
  migrateDraftImages: (docPath: string, srcs: string[]) =>
    call<ImageMigration[]>("migrate_draft_images", { docPath, srcs }),
  writeTextFile: (path: string, contents: string): Promise<void> =>
    isScopedUrl(path)
      ? iosFiles.writeText(path, contents)
      : call<void>("write_text_file", { path, contents }),
};

// ---------------------------------------------------------------------------
// session / recents (src-tauri/src/commands/session.rs, recents.rs)
// ---------------------------------------------------------------------------

export const session = {
  updateSessionPaths: (paths: string[]) =>
    desktopQuery<void>("update_session_paths", undefined, { paths }),
  cancelQuit: () => desktopQuery<void>("cancel_session_quit", undefined),
  addRecentFile: (path: string) => call<void>("add_recent_file", { path }),
};

// ---------------------------------------------------------------------------
// storage (src-tauri/src/settings.rs) - settings, UI state and the two
// histories, held by Rust in plain JSON files (docs/STORAGE.md). Only called
// when Rust booted this window (src/storage/boot.ts); without that, the
// stores fall back to localStorage.
// ---------------------------------------------------------------------------

export interface StoredSnapshot {
  value: Record<string, unknown>;
  rev: number;
}

export type HistoryKind = "chat" | "clipboard";

/** What one window read from localStorage at the first launch after the
 *  move, handed over once (see settings_import_legacy). */
export interface LegacyStorage {
  settings: Record<string, unknown>;
  uiState: Record<string, unknown>;
  chatHistory: unknown[] | null;
  clipboardHistory: unknown[] | null;
}

export const storage = {
  settingsGet: () => call<StoredSnapshot>("settings_get"),
  /** Top-level fields only; resolves to the new revision. */
  settingsPatch: (patch: Record<string, unknown>) =>
    call<number>("settings_patch", { patch }),
  settingsImportLegacy: (payload: LegacyStorage) =>
    call<StoredSnapshot & { accepted: boolean }>("settings_import_legacy", {
      payload,
    }),
  uiStateGet: () => call<Record<string, unknown>>("ui_state_get"),
  uiStatePatch: (patch: Record<string, unknown>) =>
    call<void>("ui_state_patch", { patch }),
  historyList: (kind: HistoryKind) => call<unknown[]>("history_list", { kind }),
  historyUpsert: (kind: HistoryKind, entry: unknown) =>
    call<void>("history_upsert", { kind, entry }),
  historyRemove: (kind: HistoryKind, key: string) =>
    call<void>("history_remove", { kind, key }),
  historyClear: (kind: HistoryKind) => call<void>("history_clear", { kind }),
};

// ---------------------------------------------------------------------------
// window / tab-drag (src-tauri/src/tab_drag.rs, App's pending-open queue)
// ---------------------------------------------------------------------------

export interface FloatingDragArgs {
  tab: {
    path: string | null;
    content: string;
    savedContent: string;
    diskMtime: number | null;
    helpDoc: HelpDoc | null;
  };
  title: string;
  dirty: boolean;
  destroySource: boolean;
}

export interface WindowBounds {
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  scaleFactor: number;
}

export const windowIpc = {
  takeDetachedTab: () =>
    desktopQuery<DetachedTabDoc | null>("take_detached_tab", null),
  listWindowBounds: () =>
    desktopQuery<WindowBounds[]>("list_window_bounds", []),
  startFloatingTabDrag: (args: FloatingDragArgs) =>
    desktopAction<void>("start_floating_tab_drag", args),
  startWindowDragTracking: () =>
    desktopQuery<boolean>("start_window_drag_tracking", false),
  takePendingShowHelp: () =>
    desktopQuery<string | null>("take_pending_show_help", null),
  takePendingOpenPath: () => call<string | null>("take_pending_open_path"),
  takePendingOpenPaths: () => call<string[]>("take_pending_open_paths"),
  /** Pops the chat panel out into its own OS window; resolves to its label,
   *  which is the address every later message to it is sent to. One chat
   *  window per editor window, shared by its tabs. If one already serves
   *  this window, it is focused and its label returned - and
   *  `state` is parked for it to claim (CHAT_ADOPT_HANDOFF), so a second
   *  detach hands over its conversation and pending edits just like the
   *  first one did. */
  detachChatWindow: (args: {
    state: ChatHandoffState;
    position: [number, number] | null;
    title: string;
    pinned: boolean;
  }) => desktopAction<string>("detach_chat_window", args),
  takeChatHandoff: () =>
    desktopQuery<ChatHandoff | null>("take_chat_handoff", null),
  closeChatWindow: () => desktopQuery<void>("close_chat_window", undefined),
  /** Brings the chat window serving this editor to the front, handing it
   *  nothing; false when there is none. */
  focusChatWindow: () => desktopQuery<boolean>("focus_chat_window", false),
  /** The chat window serving THIS editor window, if any - re-read after a
   *  reload, or when Rust announces a chat window opened or closed. */
  currentChatWindow: () =>
    desktopQuery<string | null>("current_chat_window", null),
};

// ---------------------------------------------------------------------------
// menu (src-tauri/src/menu.rs) - only used where the app draws its own menu
// because the native bar is gone; see ui/window-chrome.ts.
// ---------------------------------------------------------------------------

export const menuIpc = {
  /** Runs a menu id exactly as clicking its native twin would. The ids come
   *  from ui/app-menu-model.ts and are defined in src-tauri/src/menu.rs. */
  triggerMenuItem: (id: string) =>
    desktopQuery<void>("trigger_menu_item", undefined, { id }),
  /** Backs File > Open Recent, whose native submenu the app-drawn menu
   *  cannot read. */
  listRecentFiles: () => desktopQuery<string[]>("list_recent_files", []),
};

// ---------------------------------------------------------------------------
// export (src-tauri/src/commands/export.rs)
// ---------------------------------------------------------------------------

export const exportDoc = {
  exportSaveDialog: (defaultName: string, filterName: string, ext: string) =>
    call<string | null>("export_save_dialog", { defaultName, filterName, ext }),
  detectPandoc: () => desktopQuery<string | null>("detect_pandoc", null),
  exportViaPandoc: (args: {
    pandocPath: string;
    markdown: string;
    outputPath: string;
    format: string;
    resourceDir: string | null;
    title: string;
  }) => desktopAction<void>("export_via_pandoc", args),
  openPandocInstallPage: () =>
    desktopQuery<void>("open_pandoc_install_page", undefined),
  /** Nothing to show the file in on iOS - resolves without doing anything. */
  revealInDir: (path: string) =>
    desktopQuery<void>("reveal_in_dir", undefined, { path }),
  // Renders the self-contained, already-paginated themed HTML offscreen and
  // writes the PDF straight to `path` - no print dialog on any platform
  // (WKWebView createPDF / WebView2 PrintToPdf / WebKitGTK print-to-file;
  // see export.rs). baseDir resolves relative images.
  exportPdfNative: (args: {
    html: string;
    baseDir: string | null;
    outputPath: string;
  }) => desktopAction<void>("export_pdf_native", args),
};

// ---------------------------------------------------------------------------
// themes (src-tauri/src/commands/themes.rs)
// ---------------------------------------------------------------------------

export const themes = {
  saveThemeCss: (id: string, variant: "light" | "dark", css: string) =>
    call<void>("save_theme_css", { id, variant, css }),
  loadThemeCss: (id: string, variant: "light" | "dark") =>
    call<string | null>("load_theme_css", { id, variant }),
  deleteTheme: (id: string) => call<void>("delete_theme", { id }),
};

// ---------------------------------------------------------------------------
// auth (src-tauri/src/auth/*.rs) - API keys, OAuth, custom endpoint
// ---------------------------------------------------------------------------

export interface OauthStatus {
  configured: boolean;
}

export interface CustomEndpointConfig {
  base_url: string;
  api_key: string | null;
  model: string;
}

/** Provider ids with an OAuth flow and their command names - dynamic
 *  dispatch (not a fixed per-provider function) because the picker iterates
 *  the catalog and looks these up by provider id. */
const OAUTH_COMMANDS: Record<
  string,
  { status: string; login: string; logout: string }
> = {
  openai: {
    status: "codex_auth_status",
    login: "codex_login",
    logout: "codex_logout",
  },
  anthropic: {
    status: "claude_auth_status",
    login: "claude_login",
    logout: "claude_logout",
  },
};

export const auth = {
  oauthStatus: (providerId: string) =>
    call<OauthStatus>(OAUTH_COMMANDS[providerId].status),
  oauthLogin: (providerId: string) =>
    call<OauthStatus>(OAUTH_COMMANDS[providerId].login),
  oauthLogout: (providerId: string) =>
    call<void>(OAUTH_COMMANDS[providerId].logout),

  providerApiKeyStatus: (provider: string) =>
    call<boolean>("provider_api_key_status", { provider }),
  setProviderApiKey: (provider: string, key: string) =>
    call<void>("set_provider_api_key", { provider, key }),
  clearProviderApiKey: (provider: string) =>
    call<void>("clear_provider_api_key", { provider }),

  customEndpointStatus: () =>
    call<CustomEndpointConfig | null>("custom_endpoint_status"),
  setCustomEndpoint: (baseUrl: string, apiKey: string | null, model: string) =>
    call<void>("set_custom_endpoint", { baseUrl, apiKey, model }),
  clearCustomEndpoint: () => call<void>("clear_custom_endpoint"),
  fetchCustomModels: (baseUrl: string, apiKey: string | null) =>
    call<string[]>("fetch_custom_models", { baseUrl, apiKey }),
  testCustomEndpoint: (baseUrl: string, apiKey: string | null) =>
    call<void>("test_custom_endpoint", { baseUrl, apiKey }),
};

/** Image-host credentials reuse the same private 0600 credential store as
 * provider keys, under a reserved id that is never shown as an AI provider. */
const IMAGE_HOST_CREDENTIAL_ID = "__image_host";
export const imageHostAuth = {
  tokenStatus: () => auth.providerApiKeyStatus(IMAGE_HOST_CREDENTIAL_ID),
  setToken: (token: string) =>
    auth.setProviderApiKey(IMAGE_HOST_CREDENTIAL_ID, token),
  clearToken: () => auth.clearProviderApiKey(IMAGE_HOST_CREDENTIAL_ID),
};

// ---------------------------------------------------------------------------
// ai (src-tauri/src/ai/*.rs)
// ---------------------------------------------------------------------------

/// Mirrors ai::cancel::CANCELLED - the error string ai_agent_message rejects
/// with when a stop() call won the race against the in-flight request. Not a
/// real failure, so callers should treat it differently from other errors.
export const AI_CANCELLED = "cancelled";

/** One live fragment of an in-flight ai_agent_message, delivered over a
 *  Tauri channel while the agent loop runs. Purely additive display data -
 *  the command still resolves with the complete turn list, which stays the
 *  authoritative result. Mirrors `StreamEvent` in src-tauri/src/ai/agent.rs;
 *  the two must stay in sync. */
export type StreamEvent =
  | { type: "delta"; text: string }
  | { type: "toolStart"; callId: string; name: string }
  | { type: "toolArgsDelta"; callId: string; delta: string }
  | { type: "turn"; turn: AgentTurn };

/** Where the cursor sits, beyond the raw text around it - what lets a
 *  completion fit the document instead of guessing from 2000 characters.
 *  Mirrors CompletionHints in src-tauri/src/ai/client.rs. */
export interface CompletionHints {
  /** The document's first heading, when it has one. */
  title: string | null;
  /** Headings enclosing the cursor, outermost first. */
  section: string[];
  /** What the cursor is in: "paragraph", "heading", "list item", ... */
  block: string;
  /** "short" for the as-you-type nudge, "long" for an explicit request. */
  length: "short" | "long";
}

/** A project library entry (`.levis/library/*.md`, ai::project). */
export interface LibraryEntry {
  name: string;
  aliases: string[];
  include: "always" | "detected" | "never";
  /** Relative to the project root. */
  file: string;
  body: string;
}

export interface AgentWorkspaceInfo {
  instructions: string[];
  skills: AgentSkill[];
  /** The project folder; null for an unsaved draft or a folder too broad
   *  to expose (home, a drive root). */
  root: string | null;
  style: string | null;
  library: LibraryEntry[];
}

export const ai = {
  listProviders: () => call<ProviderCatalogEntry[]>("list_providers"),
  fetchAgentModels: (provider: string) =>
    call<string[]>("fetch_agent_models", { provider }),
  setAiProxy: (proxy: string | null) => call<void>("set_ai_proxy", { proxy }),
  complete: (
    provider: string,
    before: string,
    after: string,
    style: string | null,
    model: string | null,
    hints: CompletionHints | null = null,
    /** Resolve the project folder whose style profile and library the
     *  completion follows (src-tauri ai::project). */
    project: { docPath: string | null; workspaceRoot: string | null } = {
      docPath: null,
      workspaceRoot: null,
    },
  ) =>
    call<string>("ai_complete", {
      provider,
      before,
      after,
      style,
      model,
      hints,
      docPath: project.docPath,
      workspaceRoot: project.workspaceRoot,
    }),
  grammarCheck: (
    provider: string,
    paragraph: string,
    strictness: string | null,
    model: string | null,
  ) =>
    call<GrammarIssue[]>("ai_grammar_check", {
      provider,
      paragraph,
      strictness,
      model,
    }),
  agentMessage: ({
    onEvent,
    ...args
  }: {
    provider: string;
    document: string;
    docPath: string | null;
    /** Settings > Agent's explicit workspace root; null keeps the default
     *  (the document's own folder). Decides where .levis/ is read from and
     *  how far list_files/read_file may reach. */
    workspaceRoot: string | null;
    history: AgentTurn[];
    message: string;
    /** Attached images. Text-shaped attachments were already extracted and
     *  inlined into `message` by the caller. */
    images: ImageAttachment[];
    webSearch: boolean;
    mode: "ask" | "edit" | "plan";
    model: string | null;
    requestId: string;
    /** Heading of the section the cursor/selection is in - embedded in full
     *  when the document is too long to send whole (agent.rs). */
    focusHeading?: string | null;
    /** Live fragments while the request runs - see StreamEvent. */
    onEvent?: (event: StreamEvent) => void;
  }) => {
    const channel = new Channel<StreamEvent>();
    if (onEvent) channel.onmessage = onEvent;
    return call<AgentTurn[]>("ai_agent_message", {
      ...args,
      onEvent: channel,
    });
  },
  cancelAgentMessage: (requestId: string) =>
    call<void>("ai_cancel", { requestId }),

  loadAgentWorkspace: (docPath: string | null, rootOverride: string | null) =>
    call<AgentWorkspaceInfo>("load_agent_workspace", { docPath, rootOverride }),
  /** The project folder's text files, for @-mentions (ai::project). */
  listProjectFiles: (docPath: string | null, workspaceRoot: string | null) =>
    call<string[]>("list_project_files", { docPath, workspaceRoot }),
  readProjectFile: (
    docPath: string | null,
    workspaceRoot: string | null,
    path: string,
  ) => call<string>("read_project_file", { docPath, workspaceRoot, path }),
  /** Creates `.levis/<rel>` from `template` if missing; returns its path. */
  ensureProjectFile: (
    docPath: string | null,
    workspaceRoot: string | null,
    rel: string,
    template: string,
  ) =>
    call<string>("ensure_project_file", {
      docPath,
      workspaceRoot,
      rel,
      template,
    }),
  pickTextFiles: () => call<string[]>("pick_text_files"),
  /** "Learn my style": writes the project's .levis/style.md from the
   *  picked samples and returns its path. */
  learnStyle: (args: {
    provider: string;
    model: string | null;
    docPath: string | null;
    workspaceRoot: string | null;
    files: string[];
  }) => call<string>("learn_style", args),
  /** Folder picker behind Settings > Agent's "switch workspace" button. */
  pickWorkspaceRoot: (): Promise<string | null> =>
    isIOSApp
      ? iosFiles.pickProjectFolder()
      : desktopQuery<string | null>("pick_workspace_root", null),
  openGlobalAgentDir: (lang: string) =>
    desktopAction<void>("open_global_agent_dir", { lang }),
  ensureGlobalAgentMd: (lang: string) =>
    call<string>("ensure_global_agent_md", { lang }),
  importAgentSkill: () => call<AgentSkill[] | null>("import_agent_skill"),
  pickAttachmentFile: () => call<ChatAttachment | null>("pick_attachment_file"),
};

// ---------------------------------------------------------------------------
// cli (src-tauri/src/commands/cli.rs)
// ---------------------------------------------------------------------------

export const cli = {
  cliCommandStatus: () => desktopQuery<boolean>("cli_command_status", false),
  installCliCommand: () => desktopAction<void>("install_cli_command"),
};

// ---------------------------------------------------------------------------
// distribution (src-tauri/src/distribution.rs)
// ---------------------------------------------------------------------------

/** The channel this build was installed through - see distribution.rs. */
export type Distribution = "direct" | "homebrew" | "aur";

export const distribution = {
  appDistribution: () => call<Distribution>("app_distribution"),
};

// ---------------------------------------------------------------------------
// drafts (src-tauri/src/commands/drafts.rs) - best-effort autosave for
// unsaved content (draft-autosave.ts).
// ---------------------------------------------------------------------------

export interface DraftSnapshot {
  tabId: string;
  path: string | null;
  content: string;
}

export const drafts = {
  saveDraftSnapshot: (tabId: string, path: string | null, content: string) =>
    call<void>("save_draft_snapshot", { tabId, path, content }),
  takeDraftSnapshots: () => call<DraftSnapshot[]>("take_draft_snapshots"),
  clearDraftSnapshot: (tabId: string) =>
    call<void>("clear_draft_snapshot", { tabId }),
  clearAllDrafts: () => call<void>("clear_all_drafts"),
};
