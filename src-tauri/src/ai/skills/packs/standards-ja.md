---
name: standards-ja
description: >-
  Writing conventions for Japanese: typography (JTF, 公用文), numbers and counters, kanji, okurigana and kana usage, register and honorifics, fiction dialogue, business email, 公用文, ad disclosure and AI tells.
license: MIT
metadata:
  textus-version: "1"
  textus-invocation: "hidden"
  textus-sources: "Our own text. Adapted from the JTF 日本語標準スタイルガイド 第4.0版 (CC BY 4.0) and 公用文作成の考え方, 敬語の指針, 「異字同訓」の漢字の使い分け例 and 在留支援のためのやさしい日本語ガイドライン (文化庁, MEXT terms); 常用漢字表, 送り仮名の付け方, 現代仮名遣い and 外来語の表記 (unprotected); W3C JLReq (W3C licence); 消費者庁 告示第19号; textlint-ja and yomiyasu (MIT, ideas)."
---

## typography
- 「、」「。」; [ja/koyobun] horizontal text may use 「，」, one style per document; never mixed. (M) [JA-M-01]
- Kana and kanji full-width; never half-width katakana. (M) [JA-M-02]
- Digits and Latin letters half-width and uniform; data and amounts always half-width; [ja/koyobun] initialisms may be full-width (ＱＯＬ). (M) [JA-M-03]
- Symbols in prose full-width （）［］：？！, half-width in formulas, code and URLs; inequality signs in prose ＞＜. (M) [JA-M-04]
- No typed space between full-width and half-width characters (JTF標準, not JTF 標準); the renderer adds the gap; never insert CJK–Latin spaces. (M) [JA-M-05; JTF4 §2.3.1.1; JLReq §3.2.6]
- No spaces between full-width characters or around brackets; spaces inside embedded Latin text stay. (M) [JA-M-06]
- After a sentence-final ？ or ！ followed by more text, one space (full-width preferred); none inside a sentence (おおっ！という声) or before a closing bracket. (M) [JA-M-07; JLReq 3.1.6]
- Ranges with full-width ～ (18～22歳), never half-width ~; U+301C or U+FF5E per project. (M) [JA-M-08]
- No ；; ： only between a label and its content; half-width - only in addresses and phone numbers; ／ sparingly. (M) [JA-M-33]
- ！ and ？ avoided in practical body text; fine in headings, ads and questions to the reader; [ja/koyobun] allowed in 解説・広報. (M) [JA-M-34]
- "..." and ーー/−− used as dashes are wrong; …… and ―― in pairs, never split across lines; a single … or ― is a profile choice (公用文 allows it). (M) [JA-M-35]
- 。 and closing brackets: [ja/jtf] no 。 before 」 or ） inside a sentence; [ja/koyobun] 。 inside when a full sentence ends there (not after quoted words, nouns or emphasis); [ja/fiction] no 。 before 」. (M) [JA-M-14]
- Nested quotes: [ja/jtf] 『』; [ja/koyobun] 「「」」 (『』 allowed in 広報). Brackets: （） notes, 「」 quotes and emphasis, ［］ UI labels, [ja/koyobun] 【】 item labels; avoid ｛｝, 〈〉, ‘ ’. (M) [JA-M-15, JA-M-16]
- Katakana compounds: one separator style per document (・, half-width space or none); foreign names take ・; [ja/jtf] ・ not used both in compounds and as a list separator. (M) [JA-M-18, JA-M-19]
- NFC; strip zero-width and stray control characters. (M) [JA-M-39]
- [ja/koyobun] paragraph-initial 1字下げ in print only (off in the editor by default). (M) [JA-M-44]

## numbers
- Arabic numerals for quantities, ordinals and dates; kanji for idioms, approximations, set phrases and proper nouns (世界一, 数百倍, 四捨五入, 二十余人); [ja/jtf] 3つ, 1人; [ja/koyobun] 一つ, 一人. (M) [JA-M-12]
- Thousands comma and decimal point half-width; [ja/jtf] commas optional but consistent; [ja/koyobun] commas from four digits. (M) [JA-M-09]
- 万/億: one comma style per document (JTF prefers 3万8000; 公用文 accepts 1億2,644万3,000人 and 1億2644万3000人); never 千 or 百 with digits (5,000, not 5千). (M) [JA-M-10]
- Counters after digits: か or カ (3か月, 10カ所), never ヶ, ヵ, ケ or 個; 箇所, not 個所; [ja/koyobun] ○か所 with Arabic numerals, ○箇所 with kanji. (M) [JA-M-11]
- Units: one notation per document (kg or キログラム); no space between number and unit in practical text (space allowed in SI/academic text); 時・分・秒 in kanji. (M) [JA-M-36]

## words
- 常用漢字 characters and readings; kana, a paraphrase or ruby for 表外字 (おいしい, おおむね); established exceptions allowed (梱包, 斡旋, 罫線, 改竄, 楕円, 拿捕, 推敲, 莫大). (M) [JA-M-25]
- Okurigana 本則/例外 (行う, 表す, 現れる, 浮かぶ, 終わる); compound verbs keep okurigana (取り扱う, 申し込む); compound nouns consistent, [ja/koyobun] by the 訓令 list (打合せ, 取扱い, 申込み, 問合せ, 手続, 届出, 見積り); fixed terms drop it (取締役, 申込書). (M) [JA-M-20–JA-M-22]
- Kana for formal nouns and auxiliaries: こと, とき, ところ, もの, ため, よう; 〜てください, 〜ていく, できる. (M) [JA-M-23]
- Conjunctions: [ja/jtf] および, または, もしくは; [ja/koyobun] 及び, 又は, 並びに, 若しくは. ご/御: [ja/jtf] ご; [ja/koyobun] 御 + kanji word. Pronouns and adverbs per profile; 子ども [ja/jtf] / 子供 [ja/koyobun]; mixing flagged. (M) [JA-M-24, JA-M-40–JA-M-42]
- The final ー on -er/-or/-ar loanwords kept (コンピューター, ユーザー); both forms in one document flagged. (M) [JA-M-17; 外来語の表記]
- 現代仮名遣い (は/へ/を, ずつ, ぢ/づ only in 連呼 or compounds, おおきい, とおり); 々 the only repeat mark. (M) [JA-M-13, JA-M-26]
- [ja/jtf, ja/koyobun] ら抜き言葉 flagged (見れる → 見られる). (M) [JA-M-38; 国語審議会 1995]
- Redundancy (〜することができる → 〜できる; 約20名くらい; 各都道府県ごとに), double negatives, repeated particles (の…の…の). (M) [JA-M-30–JA-M-32]
- Full form before an abbreviation (…（Quality of Life。以下「QOL」という。）). (M) [JA-M-37]

## register
- です・ます for the general public, manuals, web and 広報; である for laws, notices and 訓令; letters to a party in です・ます. (S) [JA-S-01]
- Never mix です・ます and だ・である in body text; headings in 常体 or noun endings without 。; list items may be 常体 under a 敬体 body, never the reverse. (M) [JA-M-27]
- 常体 uses である; 〜すべきである, not a bare 〜すべき; no べく/べし. (M) [JA-M-28]
- Sentence length: [ja/koyobun] check from about 50–60 characters; [ja/tech] 100 characters, three 読点, six consecutive kanji. (M) [JA-M-29]
- One point per sentence; bullets for three or more items; conclusion first; no needless passive; jargon replaced or explained; concrete wording (早めに → 5月14日正午までに). (S) [JA-S-02–JA-S-07]
- Honorifics: 二重敬語 except the fixed forms (お召し上がりになる, お見えになる, お伺いする); 敬語連結 is fine; させていただく only with permission and benefit; flag 御〜される, お〜になられる and お〜になる on things; never flag とんでもございません used to deflect praise. (M/S) [JA-M-43, JA-M-45, JA-S-12]
- ウチ・ソト: to outsiders 部長の田中 or 田中, never 田中部長; 父/母 for one's own family; no 御苦労様 to superiors; 御中 only for organisations. (S) [JA-S-13–JA-S-15]
- やさしい日本語 on request: one point per sentence, no katakana loanwords or romaji, no double negatives, no 尊敬語/謙譲語, key terms kept and glossed (余震＜＝後から来る地震＞), ruby on kanji. (S) [JA-S-10]
- Bias-free, gender-neutral wording; think about how the reader will feel. (S) [JA-S-09]

## dialogue
- 「」 for speech, 『』 nested and for titles; no 。 before 」; after ？！ inside running text a full-width space when the sentence continues, none before 」; …… and ―― in pairs; paragraph-initial full-width space in book-style text is a setting (publishers differ for lines that start with 「). (M) [JA-M-07, JA-M-14; JLReq 3.1.6; Wikibooks-ja (summarised)]

## letters
- 件名; 宛名 (会社名・部署・氏名+様); 挨拶 (external お世話になっております, internal お疲れ様です); 名乗り; 要旨; 詳細; 結び; 署名; email keeps full courtesy. (S) [マイナビ (summarised); JA-S-16]

## official
- Titles state the subject and the document type (〜について（通知）); numbering 第1 → 1 → （1） → ア → （ア）; conclusion first; one style per document. (S/M) [JA-S-08; 公用文2022]

## social
- Posts involving an advertiser are clearly identifiable: 広告, 宣伝, プロモーション, PR, or a clear sentence (A社から商品の提供を受けて投稿している); not only in part of the content, briefly in video, in small or faint text, or contradicted by the text (in force 2023-10-01). (M flag) [消費者庁 告示第19号, 運用基準]

## ai-tells
- Keep 主張, 比重, 言い切りの強さ and 文の働き (事実 / 意見・評価 / 依頼・決まり / 例え / 皮肉 / 仮定・予測 / 引用・伝聞); keep 常体/敬体 as written; never turn completed actions into plans; at most two questions for the writer. [yomiyasu (MIT)]
- Stiff or wordy phrasing (〜することができる, 〜を実施する) is a clarity edit, not authorship evidence. [JA-M-32]
