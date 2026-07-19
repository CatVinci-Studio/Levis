import { useState } from "react";
import { useSettings } from "../SettingsContext";
import type { Strings } from "../../i18n/strings";
import { ToggleRow } from "./controls";
import { clearAllConversations } from "../../ai/chat-history";
import { clearClipboardHistory } from "../../utils/clipboard-history";
import { drafts } from "../../ipc";

// Settings > Privacy: each kind of locally-stored history/recovery data gets
// its own on/off switch plus an explicit "Clear" for what's already there -
// turning a switch off only stops new writes, it never retroactively
// deletes (see each Settings field's comment in SettingsContext.tsx).

function ClearRow({
  label,
  hint,
  buttonLabel,
  onClear,
}: {
  label: string;
  hint: string;
  buttonLabel: string;
  onClear: () => void;
}) {
  const [cleared, setCleared] = useState(false);

  return (
    <div className="settings-row">
      <div>
        <div className="settings-row-label">{label}</div>
        <div className="settings-row-hint">{hint}</div>
      </div>
      <button
        className="text-button settings-inline-button"
        onClick={() => {
          onClear();
          setCleared(true);
        }}
      >
        {cleared ? "✓" : buttonLabel}
      </button>
    </div>
  );
}

export function PrivacySection({ t }: { t: Strings }) {
  const { settings, setSettings } = useSettings();

  return (
    <>
      <section className="settings-group">
        <h2 className="settings-group-title">{t.privacyChatHistoryLabel}</h2>
        <div className="settings-group-body">
          <ToggleRow
            label={t.privacyChatHistoryToggle}
            hint={t.privacyChatHistoryHint}
            checked={settings.enableChatHistory}
            onChange={(v) => setSettings({ enableChatHistory: v })}
          />
          <ClearRow
            label={t.privacyClearLabel}
            hint={t.privacyChatHistoryClearHint}
            buttonLabel={t.privacyClearButton}
            onClear={clearAllConversations}
          />
        </div>
      </section>

      <section className="settings-group">
        <h2 className="settings-group-title">
          {t.privacyClipboardHistoryLabel}
        </h2>
        <div className="settings-group-body">
          <ToggleRow
            label={t.privacyClipboardHistoryToggle}
            hint={t.privacyClipboardHistoryHint}
            checked={settings.enableClipboardHistory}
            onChange={(v) => setSettings({ enableClipboardHistory: v })}
          />
          <ClearRow
            label={t.privacyClearLabel}
            hint={t.privacyClipboardHistoryClearHint}
            buttonLabel={t.privacyClearButton}
            onClear={clearClipboardHistory}
          />
        </div>
      </section>

      <section className="settings-group">
        <h2 className="settings-group-title">{t.privacyDraftRecoveryLabel}</h2>
        <div className="settings-group-body">
          <ToggleRow
            label={t.privacyDraftRecoveryToggle}
            hint={t.privacyDraftRecoveryHint}
            checked={settings.enableDraftRecovery}
            onChange={(v) => setSettings({ enableDraftRecovery: v })}
          />
          <ClearRow
            label={t.privacyClearLabel}
            hint={t.privacyDraftRecoveryClearHint}
            buttonLabel={t.privacyClearButton}
            onClear={() => void drafts.clearAllDrafts()}
          />
        </div>
      </section>
    </>
  );
}
