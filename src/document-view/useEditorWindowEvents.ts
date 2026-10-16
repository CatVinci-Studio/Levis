import { useCallback } from "react";
import { editorViewCtx } from "@milkdown/kit/core";
import {
  wrapInBulletListCommand,
  wrapInOrderedListCommand,
  wrapInBlockquoteCommand,
  createCodeBlockCommand,
} from "@milkdown/kit/preset/commonmark";
import { undoCommand, redoCommand } from "@milkdown/kit/plugin/history";
import type { EditorRunner } from "../editor/useEditorRunner";
import {
  deleteImage,
  insertHeading,
  runCommand,
  runTableAction,
  selectedImagePos,
  setImageWidth,
} from "../editor/editor-menu";
import { toggleSpan } from "../editor/marks/span-commands";
import {
  cycleHeading,
  toggleBlockquote,
  toggleList,
} from "../editor/keys/block-toggles";
import type { FindReplace } from "../editor/find/useFindReplace";
import type { EditorMenuState } from "./EditorContextMenu";
import type { AgentConversation } from "../ai/chat/useAgentConversation";
import type { AgentPanelFrame } from "../ai/chat/panel/agent-panel";
import type { ChatHistoryEntry } from "../ai/chat/chat-history";
import { showGhostSuggestion } from "../ai/writing/ghost-text-plugin";
import { showGrammarIssues } from "../ai/writing/grammar-check-plugin";
import {
  anchorGrammarIssues,
  type TutorialGrammarMock,
} from "../onboarding/tutorial-evaluation";
import type { Settings } from "../settings/SettingsContext";
import { useWindowEvent } from "../utils/hooks/useWindowEvent";
import {
  TRIGGER_COMPLETION_EVENT,
  TRIGGER_GRAMMAR_CHECK_EVENT,
  TOGGLE_FLOATING_CHAT_EVENT,
  TOGGLE_FIND_REPLACE_EVENT,
  CLOSE_FIND_REPLACE_EVENT,
  INSERT_CLIPBOARD_TEXT_EVENT,
  RESTORE_CHAT_EVENT,
  INSERT_BLOCK_EVENT,
  TOGGLE_BLOCK_EVENT,
  TOGGLE_MARK_EVENT,
  TABLE_ACTION_EVENT,
  IMAGE_ACTION_EVENT,
  EDITOR_MORE_EVENT,
  EDIT_ACTION_EVENT,
  TUTORIAL_MOCK_GHOST_EVENT,
  TUTORIAL_MOCK_GRAMMAR_EVENT,
} from "../utils/events";

/** The window events (utils/events.ts) one tab's editor answers: menu
 *  commands, shortcuts, the iPhone keyboard toolbar, the sidebar panels
 *  and the tutorial's mocks. */
export function useEditorWindowEvents({
  run,
  settings,
  tutorialMock,
  triggerCompletion,
  triggerGrammarCheck,
  toggleAgentConversation,
  findReplace,
  insertText,
  copyOrCut,
  paste,
  selectAll,
  openTableDialog,
  setMenu,
  conversation,
  agentPanel,
}: {
  run: EditorRunner;
  settings: Settings;
  tutorialMock: boolean;
  triggerCompletion: () => void;
  triggerGrammarCheck: () => void;
  toggleAgentConversation: () => void;
  findReplace: FindReplace;
  insertText: (text: string) => void;
  copyOrCut: (cut: boolean) => void;
  paste: () => void;
  selectAll: () => void;
  openTableDialog: () => void;
  setMenu: (menu: EditorMenuState) => void;
  conversation: AgentConversation;
  agentPanel: AgentPanelFrame;
}) {
  // Every open tab's editor stays mounted (App.tsx hides the inactive ones
  // with display:none, which nulls offsetParent) but the window events below
  // all mean "act on the editor the user is looking at" - without this guard
  // each fires in EVERY tab: a clipboard-history click inserts into every
  // document, a chat toggle toggles per-editor chats out of sync, and so on.
  const isOnScreen = useCallback(
    () =>
      run((ctx) => ctx.get(editorViewCtx).dom.offsetParent !== null) ?? false,
    [run],
  );

  // Shortcuts respect the same feature toggles as the context menu items -
  // a feature turned off in Settings is off through every entry point.
  // The two backend-calling triggers are also ignored while the tutorial
  // mocks AI; the chat stays available - it answers from the mock script.
  useWindowEvent(
    TRIGGER_COMPLETION_EVENT,
    () =>
      isOnScreen() &&
      !tutorialMock &&
      settings.enableCompletion &&
      triggerCompletion(),
  );
  useWindowEvent(
    TRIGGER_GRAMMAR_CHECK_EVENT,
    () =>
      isOnScreen() &&
      !tutorialMock &&
      settings.enableGrammarCheck &&
      triggerGrammarCheck(),
  );
  useWindowEvent(
    TOGGLE_FLOATING_CHAT_EVENT,
    () =>
      isOnScreen() &&
      (settings.enableAskAi || tutorialMock) &&
      toggleAgentConversation(),
  );
  useWindowEvent(
    TOGGLE_FIND_REPLACE_EVENT,
    () => isOnScreen() && findReplace.toggle(),
  );
  useWindowEvent(CLOSE_FIND_REPLACE_EVENT, () => findReplace.dismiss());

  // The tutorial's completion step: the user typed the target text, show
  // the pre-written continuation as ghost text (Tab-accept and clear-on-
  // edit come from the real plugin - only the request is mocked).
  useWindowEvent(TUTORIAL_MOCK_GHOST_EVENT, (e) => {
    if (!isOnScreen()) return;
    const suggestion = (e as CustomEvent<string>).detail;
    if (typeof suggestion !== "string" || !suggestion) return;
    run((ctx) => showGhostSuggestion(ctx.get(editorViewCtx), suggestion));
  });

  // The tutorial's grammar step: underline a PRE-WRITTEN issue in the
  // practice paragraph (same no-backend reasoning as the ghost event above).
  // The issue offsets arrive relative to the practice sentence; re-base them
  // onto the cursor's paragraph, which may hold earlier text too.
  useWindowEvent(TUTORIAL_MOCK_GRAMMAR_EVENT, (e) => {
    if (!isOnScreen()) return;
    const detail = (e as CustomEvent<TutorialGrammarMock>).detail;
    if (!detail || !Array.isArray(detail.issues) || detail.issues.length === 0)
      return;
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      const para = view.state.selection.$from.parent;
      showGrammarIssues(view, anchorGrammarIssues(para.textContent, detail));
    });
  });

  // Clipboard-history panel clicks: carries the text as CustomEvent detail.
  useWindowEvent(INSERT_CLIPBOARD_TEXT_EVENT, (e) => {
    if (!isOnScreen()) return;
    const text = (e as CustomEvent<string>).detail;
    if (typeof text === "string" && text) insertText(text);
  });

  // Native Format menu clicks (see menu-insert-block in src-tauri/src/lib.rs,
  // relayed through App.tsx): same commands the right-click Insert submenu
  // (editor-menu.ts) uses, keyed by the menu item's kind string instead of
  // a click.
  useWindowEvent(INSERT_BLOCK_EVENT, (e) => {
    if (!isOnScreen()) return;
    const kind = (e as CustomEvent<string>).detail;
    const headingMatch = /^h([1-6])$/.exec(kind);
    if (headingMatch) {
      insertHeading(run, Number(headingMatch[1]));
      return;
    }
    switch (kind) {
      case "bullet-list":
        runCommand(run, wrapInBulletListCommand.key);
        break;
      case "ordered-list":
        runCommand(run, wrapInOrderedListCommand.key);
        break;
      case "blockquote":
        runCommand(run, wrapInBlockquoteCommand.key);
        break;
      case "code-block":
        runCommand(run, createCodeBlockCommand.key);
        break;
      case "table":
        openTableDialog();
        break;
    }
  });

  // The iPhone keyboard toolbar's block buttons, which toggle (see
  // block-toggles.ts) rather than only insert.
  useWindowEvent(TOGGLE_BLOCK_EVENT, (e) => {
    if (!isOnScreen()) return;
    const kind = (e as CustomEvent<string>).detail;
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      if (kind === "heading") cycleHeading(view);
      else if (kind === "bullet-list") toggleList(view, "bullet_list");
      else if (kind === "ordered-list") toggleList(view, "ordered_list");
      else if (kind === "blockquote") toggleBlockquote(view);
      view.focus();
    });
  });

  // The iPhone keyboard toolbar's bold and italic.
  useWindowEvent(TOGGLE_MARK_EVENT, (e) => {
    if (!isOnScreen()) return;
    const mark = (e as CustomEvent<string>).detail;
    if (mark !== "bold" && mark !== "italic") return;
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      toggleSpan(view, mark === "bold" ? 2 : 1);
      view.focus();
    });
  });

  // The iPhone keyboard toolbar's table buttons: the right-click menu's
  // insert and delete items, for the table under the caret.
  useWindowEvent(TABLE_ACTION_EVENT, (e) => {
    if (!isOnScreen()) return;
    runTableAction(run, (e as CustomEvent<string>).detail);
  });

  // The iPhone keyboard toolbar's image buttons: the right-click menu's
  // width presets, and delete, for the image the selection is on.
  useWindowEvent(IMAGE_ACTION_EVENT, (e) => {
    if (!isOnScreen()) return;
    const pos = selectedImagePos(run);
    if (pos === null) return;
    const action = (e as CustomEvent<string>).detail;
    if (action === "delete") {
      deleteImage(run, pos);
      return;
    }
    const width = /^width:(auto|\d+)$/.exec(action)?.[1];
    // Still selected afterwards, so the toolbar shows the new width on and
    // another preset is a tap away.
    if (width)
      setImageWidth(run, pos, width === "auto" ? null : Number(width), true);
  });

  // The iPhone keyboard toolbar's "More": the editor's menu for where the
  // caret is, as an action sheet.
  useWindowEvent(EDITOR_MORE_EVENT, () => {
    if (!isOnScreen()) return;
    setMenu({ x: 0, y: 0, imagePos: selectedImagePos(run), phone: true });
  });

  // The app-drawn menu's Edit submenu (Windows - see app/app-menu-actions.ts).
  // These are `PredefinedMenuItem`s in the native menu, which gives them no
  // id to dispatch by, so they arrive as an event and run the very commands
  // the right-click menu (editor-menu.ts) runs.
  useWindowEvent(EDIT_ACTION_EVENT, (e) => {
    if (!isOnScreen()) return;
    switch ((e as CustomEvent<string>).detail) {
      case "undo":
        runCommand(run, undoCommand.key);
        break;
      case "redo":
        runCommand(run, redoCommand.key);
        break;
      case "cut":
        copyOrCut(true);
        break;
      case "copy":
        copyOrCut(false);
        break;
      case "paste":
        paste();
        break;
      case "select-all":
        selectAll();
        break;
    }
  });

  // Chat-history panel clicks: load the saved conversation as the live one
  // and open Quick Ask to show it - its one-line summary picks up the last
  // reply; "open full conversation" (detach) reveals the rest on demand.
  useWindowEvent(RESTORE_CHAT_EVENT, (e) => {
    if (!isOnScreen()) return;
    const entry = (e as CustomEvent<ChatHistoryEntry>).detail;
    if (!entry || !Array.isArray(entry.turns)) return;
    conversation.restore(entry.id, entry.turns);
    // The full conversation belongs in the panel; Quick Ask only ever showed
    // its last line.
    agentPanel.setOpen(true);
  });
}
