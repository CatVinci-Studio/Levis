import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AgentSkill, ChatAttachment } from "../types";
import { resolveSkillMessage } from "./proposal";
import { ai } from "../../ipc";

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
}

interface ChatComposerProps {
  /** Resolves the agent workspace (skills) - re-loaded whenever it changes. */
  docPath: string | null;
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
  selectedText,
  busy,
  labels,
  onSend,
  onStop,
  onEscape,
}: ChatComposerProps) {
  const [input, setInput] = useState("");
  const [skillIndex, setSkillIndex] = useState(0);
  const [skills, setSkills] = useState<AgentSkill[]>([]);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  // The selection rides along as context by default, but a question about
  // the document as a whole shouldn't be forced to carry whatever happened
  // to be highlighted - dropping it is a click, not a re-selection.
  //
  // Dropping it is sticky for the rest of this chat: it is not reset after a
  // send, because having the chip reappear on the next message after the user
  // just dismissed it would read as the app arguing. Getting it back means
  // reselecting and opening the chat again.
  const [selectionDropped, setSelectionDropped] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Skills come from the agent workspace on disk (global dir + the document
  // folder's .levis/skills). Loaded fresh each time the chat opens, so
  // editing a skill file takes effect on the next chat without a restart.
  useEffect(() => {
    let cancelled = false;
    ai.loadAgentWorkspace(docPath)
      .then((ws) => {
        if (!cancelled && ws?.skills) setSkills(ws.skills);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [docPath]);

  // The input grows with its content (Shift+Enter newlines) up to the CSS
  // max-height, then scrolls - a fixed single row just scrolled horizontally
  // out of view.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [input]);

  async function attachFile() {
    const file = await ai.pickAttachmentFile().catch(() => null);
    if (file) setAttachments((prev) => [...prev, file]);
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
        {attachments.length > 0 && (
          <div className="inline-chat-attachments">
            {attachments.map((file, i) => (
              <span key={i} className="inline-chat-attachment">
                {file.name}
                <button
                  className="inline-chat-attachment-remove"
                  onClick={() =>
                    setAttachments((prev) => prev.filter((_, j) => j !== i))
                  }
                >
                  ✕
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
            onClick={attachFile}
          >
            +
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
                onClick={() => setSelectionDropped(true)}
              >
                ✕
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
