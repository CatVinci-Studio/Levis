import { localeOf, type Lang } from "./langs";

/** The CLDR plural categories (Intl.PluralRules' answers). */
export type PluralCategory = "zero" | "one" | "two" | "few" | "many" | "other";

/**
 * A count string, one form per plural category the language has: English
 * has `one` and `other`, Chinese and Japanese only `other`, Russian `one`,
 * `few`, `many` and `other`. `other` is required - it is what any category
 * the language leaves out falls back to. Each form says `{n}` where the
 * number goes.
 */
export type Plural = { other: string } & Partial<
  Record<Exclude<PluralCategory, "other">, string>
>;

const rules = new Map<Lang, Intl.PluralRules>();
const numbers = new Map<Lang, Intl.NumberFormat>();

/** The form of `forms` for `n` in `lang`, with `{n}` filled in (written the
 *  way that language writes numbers: 1,234 / 1.234 / 1 234). */
export function plural(forms: Plural, n: number, lang: Lang): string {
  let pluralRules = rules.get(lang);
  if (!pluralRules) {
    pluralRules = new Intl.PluralRules(localeOf(lang));
    rules.set(lang, pluralRules);
  }
  let numberFormat = numbers.get(lang);
  if (!numberFormat) {
    numberFormat = new Intl.NumberFormat(localeOf(lang));
    numbers.set(lang, numberFormat);
  }
  const form = forms[pluralRules.select(n) as PluralCategory] ?? forms.other;
  return form.replace(/\{n\}/g, numberFormat.format(n));
}

/** The plural categories `lang` distinguishes - what a translation of a
 *  count string may define (strings.test.ts checks it). */
export function pluralCategories(lang: Lang): PluralCategory[] {
  return new Intl.PluralRules(localeOf(lang)).resolvedOptions()
    .pluralCategories as PluralCategory[];
}
