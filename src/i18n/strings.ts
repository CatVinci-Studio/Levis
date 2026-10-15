import { isLang, type Lang } from "./langs";
import type { Plural } from "./plural";
import en from "./locales/en";
import * as zh from "./locales/zh";
import * as zhHant from "./locales/zh-Hant";
import * as ja from "./locales/ja";
import * as ko from "./locales/ko";
import * as es from "./locales/es";
import * as fr from "./locales/fr";
import * as de from "./locales/de";
import * as ru from "./locales/ru";
import * as pt from "./locales/pt";

export { AI_NAME, APP_NAME } from "./names";
export {
  LANGS,
  LANG_NAMES,
  detectLang,
  isLang,
  localeOf,
  type Lang,
} from "./langs";
export { plural, type Plural } from "./plural";

type English = typeof en;

export type StringKey = keyof English;

/** The UI's strings in one language: English's keys, each a string or, for
 *  a count, the plural forms (plural.ts). */
export type Strings = {
  [K in StringKey]: English[K] extends string ? string : Plural;
};

/** The keys whose value is plain text - those that can be shown as-is. */
export type TextKey = {
  [K in StringKey]: English[K] extends string ? K : never;
}[StringKey];

/** What a language's file holds: any of English's keys, translated. A key
 *  left out shows in English. */
export type Translation = Partial<Strings>;

/** A language's file (locales/<code>.ts): its translations, and whether it
 *  claims to translate every key - strings.test.ts holds a complete one to
 *  that, so a key added later can't go untranslated unnoticed. */
interface Locale {
  default: Translation;
  complete: boolean;
}

/** Every language's file, as written. */
export const LOCALES: Record<Lang, Locale> = {
  en: { default: en, complete: true },
  zh,
  "zh-Hant": zhHant,
  ja,
  ko,
  es,
  fr,
  de,
  ru,
  pt,
};

const resolved = new Map<Lang, Strings>();

/** The strings for `lang`: its translations over English, so a key it
 *  hasn't translated yet - or a whole language that has none - shows in
 *  English instead of nothing. An unknown code (a newer build's, a hand
 *  edit) gets English. */
export function resolveStrings(lang: Lang): Strings {
  const code = isLang(lang) ? lang : "en";
  let table = resolved.get(code);
  if (!table) {
    const merged: Record<string, unknown> = { ...en };
    for (const [key, value] of Object.entries(LOCALES[code].default))
      if (value !== undefined) merged[key] = value;
    table = merged as Strings;
    resolved.set(code, table);
  }
  return table;
}
