import { TutorialExperience } from "../onboarding/TutorialExperience";
import { LanguageWelcome } from "../onboarding/LanguageWelcome";
import type { Tutorial } from "../onboarding/useTutorial";
import type { Settings } from "../settings/SettingsContext";
import { formatCombo } from "../utils/shortcuts";
import { Presence } from "../ui/usePresence";
import type { Strings } from "../i18n/strings";

/** The first-run layers over the window: the onboarding tour, and before
 *  it the language welcome - both held back while the Levis import offer
 *  is still open (onboarding-wiring.ts). */
export function OnboardingLayers({
  tutorial,
  settings,
  setSettings,
  levisPending,
  t,
}: {
  tutorial: Tutorial;
  settings: Settings;
  setSettings: (patch: Partial<Settings>) => void;
  levisPending: boolean;
  t: Strings;
}) {
  return (
    <>
      {tutorial.active && settings.languageChosen && !levisPending && (
        <TutorialExperience
          tutorial={tutorial}
          t={t}
          shortcuts={{
            completion: formatCombo(settings.shortcuts.triggerCompletion),
            grammar: formatCombo(settings.shortcuts.triggerGrammarCheck),
            agent: formatCombo(settings.shortcuts.toggleFloatingChat),
            sidebar: formatCombo(settings.shortcuts.toggleSidebar),
          }}
        />
      )}
      <Presence show={!settings.languageChosen && !levisPending} exitMs={200}>
        {!settings.languageChosen && !levisPending && (
          <LanguageWelcome
            language={settings.language}
            onLanguage={(language) => setSettings({ language })}
            onContinue={() => setSettings({ languageChosen: true })}
          />
        )}
      </Presence>
    </>
  );
}
