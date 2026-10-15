---
name: headline
description: >-
  Writes or improves titles, headlines, subject lines and headings that are
  accurate, specific and within the target's length and case conventions (page
  titles, 公众号, 小红书, academic titles, email subjects); offers options when
  asked. Use when asked for a title, headline, subject line or a better heading
  (标题/起标题, 見出し・タイトル, 제목, título, titre, Überschrift, заголовок).
license: MIT
metadata:
  levis-version: "1"
  levis-invocation: "both"
  levis-category: "format"
  levis-packs: "contract craft#platforms"
  levis-sources: "Our own text. Length limits from GOV.UK (OGL v3.0), the WeChat API documentation (facts) and GB/T 7713.2 (summarised); case styles summarised from Chicago 18, AP, APA and MLA; 网络信息内容生态治理规定 Art. 7."
  levis-aliases-en: "title, subject"
  levis-aliases-zh: "起标题, 标题, 题目"
  levis-aliases-zh-Hant: "下標題, 標題"
  levis-aliases-ja: "見出し・タイトル, タイトル, 見出し, 件名"
  levis-aliases-ko: "제목"
  levis-aliases-es: "título"
  levis-aliases-fr: "titre"
  levis-aliases-de: "überschrift, titel"
  levis-aliases-ru: "заголовок"
  levis-aliases-pt: "título, manchete"
---

# Headline or title

## Scope
- The document's title (H1) by default; else the heading, subject line or post the user names.

## Do
- Accurate: promise only what the text delivers. Specific: use the concrete nouns and numbers the text gives, with the key words first.
- Length by target: web page title at most 65 characters; 公众号 title at most 32 characters; 小红书 title about 20 (unverified, warn only); Chinese academic title at most 25 characters with no hype; email subject about 5–8 words. Check every candidate with measure_text before proposing it (`chars`, `wechat_title`, `xhs_title`, `govuk_title`, `zh_academic_title`).
- Case and punctuation: sentence case by default in English, title case only when the document or project uses a style that asks for it (Chicago, AP, APA, MLA); no final period; Chinese headings never end with 。，、；：; Japanese official titles state the subject and the document type; GOV.UK titles use no question, dash or slash.
- Match the document's language and register.

## Don't
- Invent a number, result or claim for the headline.
- Use clickbait, exaggeration or shock words (震惊, 必看, "you won't believe"), or stacked ！！.

## Deliver
- Edit mode: replace the H1 (or insert one when the document has none). One proposal.
- When the user asks for options, or in Ask mode: the options in the reply as a list, each within the length limit, no edit.
- Reply in one sentence on the angle you chose.
