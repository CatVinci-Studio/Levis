import { invoke } from "@tauri-apps/api/core";
import type { DetachedTabDoc, HelpDoc } from "./doc-tabs";
import type { DirEntryInfo } from "./sidebar/types";
import type { ProviderCatalogEntry } from "./ai/provider-catalog";
import type { AgentSkill, AgentTurn, ChatAttachment } from "./ai/types";
import type { GrammarIssue } from "./ai/grammar-check-plugin";

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

// ---------------------------------------------------------------------------
// fs (src-tauri/src/commands/fs.rs)
// ---------------------------------------------------------------------------

export interface AttachedFile {
  name: string;
  content: string;
}

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
  openFileDialog: () => call<string | null>("open_file_dialog"),
  openCssFileDialog: () => call<string | null>("open_css_file_dialog"),
  saveFileDialog: () => call<string | null>("save_file_dialog"),
  pickAttachmentFile: () => call<AttachedFile | null>("pick_attachment_file"),
  listDir: (path: string) => call<DirEntryInfo[]>("list_dir", { path }),
  fileMtimeMs: (path: string) => call<number | null>("file_mtime_ms", { path }),
  readTextFile: (path: string) => call<string>("read_text_file", { path }),
  readBinaryFileBase64: (path: string) =>
    call<string>("read_binary_file_base64", { path }),
  savePastedImage: (docPath: string | null, dataBase64: string, ext: string) =>
    call<SavedImage>("save_pasted_image", { docPath, dataBase64, ext }),
  migrateDraftImages: (docPath: string, srcs: string[]) =>
    call<ImageMigration[]>("migrate_draft_images", { docPath, srcs }),
  writeTextFile: (path: string, contents: string) =>
    call<void>("write_text_file", { path, contents }),
};

// ---------------------------------------------------------------------------
// session / recents (src-tauri/src/commands/session.rs, recents.rs)
// ---------------------------------------------------------------------------

export const session = {
  updateSessionPaths: (paths: string[]) =>
    call<void>("update_session_paths", { paths }),
  addRecentFile: (path: string) => call<void>("add_recent_file", { path }),
};

// ---------------------------------------------------------------------------
// prefs (src-tauri/src/commands/prefs.rs) - the two frontend settings
// mirrored into Rust because they're needed before any webview exists.
// ---------------------------------------------------------------------------

export const prefs = {
  setNewDocumentMode: (mode: string) =>
    call<void>("set_new_document_mode", { mode }),
  setRestoreSessionOnStartup: (enabled: boolean) =>
    call<void>("set_restore_session_on_startup", { enabled }),
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
  takeDetachedTab: () => call<DetachedTabDoc | null>("take_detached_tab"),
  listWindowBounds: () => call<WindowBounds[]>("list_window_bounds"),
  startFloatingTabDrag: (args: FloatingDragArgs) =>
    call<void>("start_floating_tab_drag", args),
  startWindowDragTracking: () => call<boolean>("start_window_drag_tracking"),
  takePendingShowHelp: () => call<string | null>("take_pending_show_help"),
  takePendingOpenPath: () => call<string | null>("take_pending_open_path"),
  takePendingOpenPaths: () => call<string[]>("take_pending_open_paths"),
};

// ---------------------------------------------------------------------------
// export (src-tauri/src/commands/export.rs)
// ---------------------------------------------------------------------------

export const exportDoc = {
  exportSaveDialog: (defaultName: string, filterName: string, ext: string) =>
    call<string | null>("export_save_dialog", { defaultName, filterName, ext }),
  detectPandoc: () => call<string | null>("detect_pandoc"),
  exportViaPandoc: (args: {
    pandocPath: string;
    markdown: string;
    outputPath: string;
    format: string;
    resourceDir: string | null;
    title: string;
  }) => call<void>("export_via_pandoc", args),
  openPandocInstallPage: () => call<void>("open_pandoc_install_page"),
  revealInDir: (path: string) => call<void>("reveal_in_dir", { path }),
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
export const OAUTH_COMMANDS: Record<
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

// ---------------------------------------------------------------------------
// ai (src-tauri/src/ai/*.rs)
// ---------------------------------------------------------------------------

/// Mirrors ai::cancel::CANCELLED - the error string ai_agent_message rejects
/// with when a stop() call won the race against the in-flight request. Not a
/// real failure, so callers should treat it differently from other errors.
export const AI_CANCELLED = "cancelled";

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
  ) => call<string>("ai_complete", { provider, before, after, style, model }),
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
  agentMessage: (args: {
    provider: string;
    document: string;
    docPath: string | null;
    history: AgentTurn[];
    message: string;
    webSearch: boolean;
    model: string | null;
    requestId: string;
  }) => call<AgentTurn[]>("ai_agent_message", args),
  cancelAgentMessage: (requestId: string) =>
    call<void>("ai_cancel", { requestId }),

  loadAgentWorkspace: (docPath: string | null) =>
    call<{ instructions: string[]; skills: AgentSkill[]; root: string | null }>(
      "load_agent_workspace",
      { docPath },
    ),
  openGlobalAgentDir: (lang: string) =>
    call<void>("open_global_agent_dir", { lang }),
  ensureGlobalAgentMd: (lang: string) =>
    call<string>("ensure_global_agent_md", { lang }),
  importAgentSkill: () => call<AgentSkill[] | null>("import_agent_skill"),
  pickAttachmentFile: () => call<ChatAttachment | null>("pick_attachment_file"),
};

// ---------------------------------------------------------------------------
// cli (src-tauri/src/commands/cli.rs)
// ---------------------------------------------------------------------------

export const cli = {
  cliCommandStatus: () => call<boolean>("cli_command_status"),
  installCliCommand: () => call<void>("install_cli_command"),
};

// ---------------------------------------------------------------------------
// drafts (src-tauri/src/commands/drafts.rs) - best-effort autosave for
// unsaved content, see 2.4 in the reliability plan.
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
