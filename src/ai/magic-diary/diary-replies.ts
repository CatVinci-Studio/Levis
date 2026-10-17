import { storyReply, everydayReply, type StoryExchange } from "./diary-story";
import type { Lang } from "../../i18n/langs";

/**
 * The lines the page says when nothing answers back.
 *
 * The Magic Diary's reply comes from the model when one is configured, but
 * an easter egg that needs an account, a key and a working network isn't an
 * easter egg - it's a setting. These are what it says when the request
 * fails, times out, or finds no provider set up at all, so the effect is
 * always available to whoever turns it on.
 *
 * Written per language rather than translated from English: the whole point
 * is that the page answers in the reader's own tongue. Each is a sentence
 * that could be said in reply to almost anything written on the line before
 * it, which is why none of them refers back to what that line was - a pool
 * that guessed at the text would misfire on most of what gets written
 * here.
 */
const REPLIES: Record<Lang, readonly string[]> = {
  en: [
    "This page has read that twice already, and is not tired of it.",
    "Keep it. You will know in the morning whether it was right.",
    "Ink dries faster than doubt. Let it dry.",
    "You have already decided; you are only asking to be told.",
    "Nothing written at night is wasted. Some of it is only waiting.",
    "The margin is wide enough for what you did not say.",
  ],
  zh: [
    "这一页读过两遍了，并不厌倦。",
    "先留着。明天你会知道它对不对。",
    "墨干得比疑虑快。让它干。",
    "你早就决定了，只是在求一个确认。",
    "夜里写下的没有白费，有些只是还在等。",
    "页边够宽，放得下你没说的那些。",
  ],
  "zh-Hant": [
    "這一頁讀過兩遍了，並不厭倦。",
    "先留著。明天你會知道它對不對。",
    "墨乾得比疑慮快。讓它乾。",
    "你早就決定了，只是在求一個確認。",
    "夜裡寫下的沒有白費，有些只是還在等。",
    "頁邊夠寬，放得下你沒說的那些。",
  ],
  ja: [
    "このページはもう二度読んだ。それでも退屈ではない。",
    "残しておきなさい。明日の朝、合うかどうかがわかる。",
    "墨は迷いより速く乾く。乾かすといい。",
    "もう決めている。確認がほしいだけだ。",
    "夜に書いたものが無駄になることはない。待つだけのものもある。",
    "余白は広い。言わなかった分も、収まる。",
  ],
  ko: [
    "이 쪽지는 이미 두 번 읽었다. 지루하지 않다.",
    "남겨 둬요. 내일 아침에 맞는지 알 텐데요.",
    "먹번은 고민보다 빨리 마른다. 마르게 두세요.",
    "이미 정했어요. 확인만 받으려는 거죠.",
    "밤에 쓴 것은 헛되지 않아. 기다리기만 하는 것도 있고.",
    "여백은 넓어요. 말하지 않은 것도 들어갑니다.",
  ],
  es: [
    "Esta página ya te ha leído dos veces. Y no se cansa.",
    "Déjalo. Mañana sabrás si era verdad.",
    "La tinta seca antes que la duda. Déjala secar.",
    "Ya lo has decidido; solo pides que te lo confirmen.",
    "Nada escrito de noche se pierde. Solo hay cosas que esperan.",
    "El margen es ancho. Cabe lo que no dijiste.",
  ],
  fr: [
    "Cette page t'a déjà lu deux fois. Elle ne s'en lasse pas.",
    "Laisse-le. Demain, tu sauras s'il était vrai.",
    "L'encre sèche avant le doute. Laisse-la sécher.",
    "Tu as déjà tranché ; tu demandes qu'on te le confirme.",
    "Rien d'écrit la nuit ne se perd. Certaines choses attendent.",
    "La marge est large. Ce que tu n'as pas dit y tient.",
  ],
  de: [
    "Diese Seite hat dich schon zweimal gelesen. Es wird nicht müde.",
    "Lass es stehen. Morgens weißt du, ob es stimmte.",
    "Die Tinte trocknet schneller als der Zweifel. Lass sie trocknen.",
    "Du hast entschieden; du bittest nur um Bestätigung.",
    "Nichts, was nachts geschrieben wird, ist verloren. Manche Dinge warten.",
    "Der Rand ist breit. Es passt, was du nicht gesagt hast.",
  ],
  ru: [
    "Эта страница читала тебя дважды. И не устала.",
    "Оставь. Утром поймёшь, было ли это верно.",
    "Чернила сохнут быстрее сомнений. Дай им высохнуть.",
    "Ты уже решил; тебе нужно лишь подтверждение.",
    "Написанное ночью не пропадает. Некоторые вещи просто ждут.",
    "Поле широкое. То, что ты не сказал, поместится.",
  ],
  pt: [
    "Esta página já te leu duas vezes. E não se cansa.",
    "Deixa. Amanhã vais saber se era verdade.",
    "A tinta seca antes da dúvida. Deixa secar.",
    "Já decidiste; só pedes que te confirmem.",
    "Nada escrito à noite se perde. Há coisas que só esperam.",
    "A margem é larga. Cabe o que não disseste.",
  ],
};

/** What the page says for `line`, in `language`.
 *
 *  Chosen by the line rather than at random: the same line always draws the
 *  same reply, which is what makes it read as a page with a temper rather
 *  than a slot machine. An unrecognised language falls back to English,
 *  the same way the string tables do.
 */
export function scriptedReply(
  language: string,
  line: string,
  history: StoryExchange[] = [],
): string {
  const story = storyReply(language, line, history);
  if (story) return story;
  const everyday = everydayReply(language, line);
  if (everyday) return everyday;
  const pool = REPLIES[language as Lang] ?? REPLIES.en;
  return pool[hashLine(line) % pool.length];
}

/** FNV-1a over the line's code units. Any stable hash will do - this one is
 *  two lines and spreads short lines (which differ in their last character
 *  far more often than their first) better than a per-character sum. */
function hashLine(line: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < line.length; i++) {
    hash ^= line.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
