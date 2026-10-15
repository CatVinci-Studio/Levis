import { useEffect, useRef, useState } from "react";
import { levisImport, type LevisImportStatus, type LevisItem } from "../ipc";
import { localeOf, type Lang, type Strings } from "../i18n/strings";
import { showConfirm, showMessage } from "../ui/app-dialog";
import { errorText } from "../utils/error-text";

// Bringing a Levis installation into Textus (src-tauri/src/levis_import.rs
// does the copying): offered once on the first launch, and from Settings >
// General any time after. Only copies; Levis keeps its files.

const ITEM_LABEL: Record<LevisItem, keyof Strings> = {
  settings: "levisItemSettings",
  chatHistory: "levisItemChatHistory",
  clipboardHistory: "levisItemClipboardHistory",
  themes: "levisItemThemes",
  writingInstructions: "levisItemWritingInstructions",
  skills: "levisItemSkills",
  recentFiles: "levisItemRecentFiles",
  session: "levisItemSession",
  drafts: "levisItemDrafts",
  credentials: "levisItemCredentials",
};

/** "settings, themes and skills", in the UI's language. */
export function itemList(t: Strings, lang: Lang, items: LevisItem[]): string {
  const labels = items.map((item) => String(t[ITEM_LABEL[item]]));
  // Intl.ListFormat is in every webview the app runs in, but not in the
  // TypeScript lib this project targets.
  const ListFormat = (
    Intl as unknown as {
      ListFormat?: new (
        locale: string,
        options: { style: string; type: string },
      ) => { format(items: string[]): string };
    }
  ).ListFormat;
  if (!ListFormat) return labels.join(", ");
  return new ListFormat(localeOf(lang), {
    style: "long",
    type: "conjunction",
  }).format(labels);
}

/** Asks, copies and reports. Resolves whether anything was imported. */
export async function runLevisImport(
  t: Strings,
  lang: Lang,
  status: LevisImportStatus,
): Promise<boolean> {
  if (!status.supported || status.items.length === 0) return false;
  const go = await showConfirm(t.levisImportText, {
    title: t.levisImportTitle,
    okLabel: t.levisImportOk,
    cancelLabel: t.levisImportLater,
  });
  if (!go) return false;
  const credentials =
    status.items.includes("credentials") &&
    (await showConfirm(t.levisImportKeysText, {
      title: t.levisImportKeysTitle,
      okLabel: t.levisImportKeysOk,
      cancelLabel: t.levisImportKeysSkip,
    }));
  try {
    const report = await levisImport.run(credentials);
    const lines = [
      report.imported.length > 0
        ? t.levisImportDone.replace(
            "{items}",
            itemList(t, lang, report.imported),
          )
        : t.levisImportNothing,
    ];
    if (report.failed.length > 0)
      lines.push(t.levisImportFailed, ...report.failed);
    await showMessage(lines.join("\n"), {
      title: t.levisImportRow,
      tone: report.failed.length > 0 ? "warning" : "info",
    });
    return report.imported.length > 0;
  } catch (err) {
    await showMessage(`${t.levisImportFailed}\n${errorText(err)}`, {
      title: t.levisImportRow,
      tone: "error",
    });
    return false;
  }
}

/**
 * The first-launch offer. While it is being decided (`pending`), the
 * language welcome waits: an import brings Levis's own language choice,
 * so a Levis user isn't asked again.
 */
export function useLevisImportOffer(
  t: Strings,
  lang: Lang,
  offered: boolean,
  markOffered: () => void,
): { pending: boolean } {
  const [pending, setPending] = useState(!offered);
  const started = useRef(false);
  useEffect(() => {
    if (offered) {
      setPending(false);
      return;
    }
    if (started.current) return;
    started.current = true;
    void (async () => {
      try {
        const status = await levisImport.status();
        // Marked only once it was asked: with nothing to offer, the check
        // (a few file lookups) simply runs again next launch.
        if (status?.supported && status.items.length > 0) {
          await runLevisImport(t, lang, status);
          markOffered();
        }
      } catch {
        // No backend (the browser build) or no app directories: no offer.
      } finally {
        setPending(false);
      }
    })();
  }, [offered, t, lang, markOffered]);
  return { pending };
}
