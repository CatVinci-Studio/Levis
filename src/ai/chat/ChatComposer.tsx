import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AgentSkill, ChatAttachment } from "../types";
import { resolveSkillMessage } from "./proposal";
import { ai, IpcError } from "../../ipc";
import { useActiveProvider } from "../provider-catalog";
import {
  CloseIcon,
  GenericFileIcon,
  ImageFileIcon,
  PlusIcon,
} from "../../ui/icons";

export interface ChatComposerLabels {
  /** Accessible name of the selection chip's remove button. */
  dropSelection: string;
  placeholder: string;
  send: string;
  /** Send button's label while a request is in flight - clicking it then
   *  stops the request instead of sending. */
  stop: string;
  /** Tooltip of the "+" attach-file button. */
  attachFile: string;
  /** The selection chip's text; "{n}" is replaced with the char count. */
  selectedChars: string;
  /** Suffix on an attachment chip whose text was cut at the extraction cap. */
  attachmentTruncated: string;
  /** Shown when an image is attached but the active provider has no vision. */
  attachmentNoVision: string;
}

interface ChatComposerProps {
  /** Resolves the agent workspace (skills) - re-loaded whenever it changes. */
  docPath: string | null;
  /** Explicit workspace root, or null for the document's own folder. Skills
   *  come from whichever it resolves to. */
  workspaceRoot: string | null;
  selectedText: string | null;
  busy: boolean;
  labels: ChatComposerLabels;
  /** The resolved message (skill expanded) plus any attachments - InlineChat
   *  owns tagging it with selected-text/chatInfo and actually sending it. */
  onSend: (
    message: string,
    attachments: ChatAttachment[],
    /** False once the user has removed the selection chip. */
    includeSelection: boolean,
  ) => void;
  onStop: () => void;
  onEscape: () => void;
}

/**
 * The input row: auto-growing textarea, attach button, selection chip, send
 * button, and the /name skill picker it drives. Self-contained input state
 * (what's typed, staged attachments) - InlineChat only hears about a
 * finished, resolved message via onSend.
 */
export function ChatComposer({
  docPath,
  workspaceRoot,
  selectedText,
  busy,
  labels,
  onSend,
  onStop,
  onEscape,
}: ChatComposerProps) {
  // Derived here rather than passed in: this is the only place an image can
  // be staged, so deriving it at the gate makes it impossible for a caller to
  // forget - which is exactly what happened when it was a prop, leaving Quick
  // Ask happy to attach an image to a provider that can't read one.
  const supportsVision = useActiveProvider()?.supportsVision ?? true;
  const [input, setInput] = useState("");
  const [skillIndex, setSkillIndex] = useState(0);
  const [skills, setSkills] = useState<AgentSkill[]>([]);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  // Why an attachment couldn't be used ("this PDF has no text layer", "too
  // large", ...). Shown, never swallowed: the previous version caught and
  // discarded every failure, so picking a PDF - which could not work at all,
  // the reader being read_to_string - looked exactly like a dead "+" button.
  const [attachError, setAttachError] = useState<string | null>(null);
  // The selection rides along as context by default, but a question about
  // the document as a whole shouldn't be forced to carry whatever happened
  // to be highlighted - dropping it is a click, not a re-selection.
  //
  // Dropping applies to THAT selection, not to the chat forever: in the
  // detached window the user goes on highlighting new passages, and each one
  // is a fresh request to talk about it. Remembering which text was
  // dismissed (rather than a bare flag) gets both halves right - the chip
  // stays gone while that selection is current, and a genuinely new
  // selection brings it back without the user having to reopen anything.
  const [droppedSelection, setDroppedSelection] = useState<string | null>(null);
  const selectionDropped =
    droppedSelection !== null && droppedSelection === selectedText;
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Skills come from the agent workspace on disk (global dir + the workspace
  // root's .levis/skills). Loaded fresh each time the chat opens, so editing
  // a skill file takes effect on the next chat without a restart.
  useEffect(() => {
    let cancelled = false;
    ai.loadAgentWorkspace(docPath, workspaceRoot)
      .then((ws) => {
        if (!cancelled && ws?.skills) setSkills(ws.skills);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [docPath, workspaceRoot]);

  // The input grows with its content (Shift+Enter newlines) up to the CSS
  // max-height, then scrolls - a fixed single row just scrolled horizontally
  // out of view.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    let needed = el.scrollHeight;
    el.style.height = `${needed}px`;
    // scrollHeight is an integer, so the height just written can land a
    // fraction of a pixel short of the line box it was measured from -
    // WebKit then treats the textarea as scrolled by that hair, which clips
    // the caret (most visible with CJK text, whose glyph box fills the line
    // completely). One correction pass, and it fits whatever the font does.
    if (el.scrollHeight > el.clientHeight) {
      needed += el.scrollHeight - el.clientHeight;
      el.style.height = `${needed}px`;
    }
    // Scrolling is enabled only once the content genuinely outgrows the box;
    // leaving it permanently on is what drew scrollbars around an EMPTY input.
    const max = parseFloat(getComputedStyle(el).maxHeight);
    el.style.overflowY = needed > max ? "auto" : "hidden";
  }, [input]);

  async function attachFile() {
    setAttachError(null);
    try {
      const file = await ai.pickAttachmentFile();
      // null means the picker was cancelled - not something to report.
      if (!file) return;
      if (file.kind === "image" && !supportsVision) {
        setAttachError(labels.attachmentNoVision);
        return;
      }
      setAttachments((prev) => [...prev, file]);
    } catch (err) {
      setAttachError(err instanceof IpcError ? String(err.cause) : String(err));
    }
  }

  // Skill picker: open while the input is a single /token still being typed
  // (no space yet), filtered by that prefix. Purely derived from the input,
  // so it closes itself once the name is completed or the slash is deleted.
  const skillQuery = /^\/(\S*)$/.exec(input);
  const matchingSkills = skillQuery
    ? skills.filter((s) =>
        s.name.toLowerCase().startsWith(skillQuery[1].toLowerCase()),
      )
    : [];
  const activeSkillIndex = Math.min(
    skillIndex,
    Math.max(0, matchingSkills.length - 1),
  );

  function pickSkill(skill: AgentSkill) {
    setInput(`/${skill.name} `);
    setSkillIndex(0);
  }

  function submit() {
    const message = resolveSkillMessage(input.trim(), skills);
    if (!message || busy) return;
    setInput("");
    const staged = attachments;
    setAttachments([]);
    onSend(message, staged, !selectionDropped);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    // Keys pressed while an IME composition is active belong to the IME
    // (Enter confirms the composed characters, arrows navigate candidates) -
    // acting on them here sent half-typed CJK messages. WebKit can also fire
    // the confirming keydown just after compositionend with isComposing
    // already false but the legacy keyCode still 229, so check both.
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    // While the skill picker is open, the navigation keys drive it instead
    // of the chat (Enter completes the skill name rather than sending).
    if (matchingSkills.length > 0) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const delta = e.key === "ArrowDown" ? 1 : -1;
        setSkillIndex(
          (activeSkillIndex + delta + matchingSkills.length) %
            matchingSkills.length,
        );
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pickSkill(matchingSkills[activeSkillIndex]);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
    if (e.key === "Escape") onEscape();
  }

  return (
    <>
      {matchingSkills.length > 0 && (
        <div className="inline-chat-skill-menu">
          {matchingSkills.map((skill, i) => (
            <button
              key={skill.name}
              className={`inline-chat-skill-item ${i === activeSkillIndex ? "inline-chat-skill-item-active" : ""}`}
              // mousedown, not click: keeps focus in the textarea.
              onMouseDown={(e) => {
                e.preventDefault();
                pickSkill(skill);
              }}
            >
              <span className="inline-chat-skill-name">/{skill.name}</span>
              <span className="inline-chat-skill-preview">
                {skill.description || skill.prompt}
              </span>
            </button>
          ))}
        </div>
      )}
      <div className="inline-chat-bar">
        {attachError && (
          <div className="inline-chat-attach-error">{attachError}</div>
        )}
        {attachments.length > 0 && (
          <div className="inline-chat-attachments">
            {attachments.map((file, i) => (
              <span key={i} className="inline-chat-attachment">
                {/* The two kinds reach the model in completely different
                    ways - extracted text in the prompt, or a native image
                    part - so the chip says which this is. */}
                {file.kind === "image" ? (
                  <ImageFileIcon className="inline-chat-attachment-kind" />
                ) : (
                  <GenericFileIcon className="inline-chat-attachment-kind" />
                )}
                {file.name}
                {/* A file cut at the extraction cap must say so - otherwise
                    a partial answer looks like the model misread the whole
                    document rather than having seen only part of it. */}
                {file.kind === "text" && file.truncated && (
                  <span className="inline-chat-attachment-note">
                    {labels.attachmentTruncated}
                  </span>
                )}
                <button
                  className="inline-chat-attachment-remove"
                  onClick={() =>
                    setAttachments((prev) => prev.filter((_, j) => j !== i))
                  }
                >
                  <CloseIcon />
                </button>
              </span>
            ))}
          </div>
        )}
        <textarea
          ref={inputRef}
          className="inline-chat-input"
          rows={1}
          placeholder={labels.placeholder}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setSkillIndex(0);
          }}
          onKeyDown={onKeyDown}
          autoFocus
        />
        <div className="inline-chat-toolbar">
          <button
            className="inline-chat-attach"
            title={labels.attachFile}
            aria-label={labels.attachFile}
            onClick={attachFile}
          >
            <PlusIcon />
          </button>
          {selectedText && !selectionDropped && (
            <span className="inline-chat-selection-chip">
              {labels.selectedChars.replace(
                "{n}",
                String([...selectedText].length),
              )}
              <button
                type="button"
                className="inline-chat-chip-remove"
                aria-label={labels.dropSelection}
                title={labels.dropSelection}
                onClick={() => setDroppedSelection(selectedText)}
              >
                <CloseIcon />
              </button>
            </span>
          )}
          <button
            className="inline-chat-send"
            onClick={busy ? onStop : submit}
            disabled={!busy && !input.trim()}
          >
            {busy ? labels.stop : labels.send}
          </button>
        </div>
      </div>
    </>
  );
}
