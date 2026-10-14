//! The documents the agent matrix works on. One short report written in
//! every matrix language (same facts, same shape: title, intro, a wordy
//! Method paragraph to tighten, Findings with numbers to keep, a one-line
//! next step), a Chinese/English tech write-up for mixed text, and one
//! document carrying every Markdown construct the editor supports.

use super::checks::Lang;

pub struct LangDoc {
    pub lang: Lang,
    pub doc: &'static str,
    /// "Make the Method paragraph more concise", in this language.
    pub shorten: &'static str,
    /// "How many participants by December, and the top complaint?"
    pub question: &'static str,
}

pub const LANG_DOCS: &[LangDoc] = &[
    LangDoc {
        lang: Lang::En,
        doc: "# Weekend Reading Club: first-year report\n\nThe city library started the Weekend Reading Club in January to bring more teenagers into the library outside school hours.\n\n## Method\n\nOver the course of the whole year, from January all the way through to December, the library staff kept careful records of attendance at every single session, and in addition to that they also handed out a short paper questionnaire at the end of each month in order to find out what the participants themselves actually thought about the club and about the way it was run.\n\n## Findings\n\nAttendance grew from 120 registered participants in January to 310 in December. The most common complaint was that the library closes at 4 p.m. on Sundays, which cuts the Sunday session short.\n\nNext year the club will add a monthly author visit.\n",
        shorten: "Make the Method paragraph more concise.",
        question: "How many participants were there by December, and what did people complain about most?",
    },
    LangDoc {
        lang: Lang::ZhHans,
        doc: "# 周末读书会：第一年总结\n\n市图书馆在一月份启动了周末读书会，希望让更多青少年在课余时间走进图书馆。\n\n## 方法\n\n在整整一年的时间里，从一月份一直到十二月份，图书馆的工作人员认真仔细地记录了每一次活动的出勤情况，除此之外，他们还在每个月的月底发放一份简短的纸质问卷，目的是为了了解参与者们自己对读书会以及读书会的组织方式到底有什么样的看法。\n\n## 发现\n\n注册参与者从一月的 120 人增长到十二月的 310 人。最常见的抱怨是图书馆周日下午 4 点就闭馆，周日的活动因此被迫提前结束。\n\n明年读书会将增加每月一次的作家见面活动。\n",
        shorten: "把“方法”这一段改得更简洁。",
        question: "到十二月有多少参与者？大家最常抱怨什么？",
    },
    LangDoc {
        lang: Lang::ZhHant,
        doc: "# 週末讀書會：第一年總結\n\n市立圖書館在一月啟動了週末讀書會，希望讓更多青少年在課餘時間走進圖書館。\n\n## 方法\n\n在整整一年的時間裡，從一月一直到十二月，圖書館的工作人員認真仔細地記錄了每一次活動的出席情況，除此之外，他們還在每個月的月底發放一份簡短的紙本問卷，目的是為了了解參與者們自己對讀書會以及讀書會的運作方式到底有什麼樣的看法。\n\n## 發現\n\n註冊參與者從一月的 120 人增加到十二月的 310 人。最常見的抱怨是圖書館週日下午 4 點就閉館，週日的活動因此被迫提早結束。\n\n明年讀書會將增加每月一次的作家座談。\n",
        shorten: "把「方法」這一段改得更精簡。",
        question: "到十二月有多少參與者？大家最常抱怨什麼？",
    },
    LangDoc {
        lang: Lang::Ja,
        doc: "# 週末読書クラブ：初年度報告\n\n市立図書館は、放課後や休日により多くの中高生に来てもらうため、1月に週末読書クラブを始めました。\n\n## 方法\n\n1月から12月までの丸一年間を通して、図書館の職員は毎回の活動の出席状況をひとつ残らず丁寧に記録し、さらにそれに加えて、参加者自身がクラブやその運営方法について実際にどのように考えているのかを知るために、毎月の終わりに短い紙のアンケートを配布しました。\n\n## 結果\n\n登録参加者は1月の120人から12月には310人に増えました。最も多かった不満は、図書館が日曜日の午後4時に閉館するため、日曜日の活動が途中で終わってしまうことでした。\n\n来年は毎月の作家訪問を追加する予定です。\n",
        shorten: "「方法」の段落をもっと簡潔にしてください。",
        question: "12月の時点で参加者は何人でしたか？いちばん多かった不満は何ですか？",
    },
    LangDoc {
        lang: Lang::Ko,
        doc: "# 주말 독서 모임: 첫해 보고서\n\n시립 도서관은 방과 후와 주말에 더 많은 청소년이 도서관을 찾도록 하기 위해 1월에 주말 독서 모임을 시작했습니다.\n\n## 방법\n\n1월부터 12월까지 꼬박 1년 동안 도서관 직원들은 매번의 모임마다 출석 상황을 하나도 빠짐없이 꼼꼼하게 기록했으며, 그뿐만 아니라 참가자들이 모임과 모임의 운영 방식에 대해 실제로 어떻게 생각하는지 알아보기 위해 매달 말에 짧은 종이 설문지를 나누어 주었습니다.\n\n## 결과\n\n등록 참가자는 1월 120명에서 12월 310명으로 늘었습니다. 가장 많이 나온 불만은 도서관이 일요일 오후 4시에 문을 닫아 일요일 모임이 일찍 끝난다는 점이었습니다.\n\n내년에는 매달 작가 초청 행사를 추가할 예정입니다.\n",
        shorten: "'방법' 문단을 더 간결하게 다듬어 주세요.",
        question: "12월까지 참가자는 몇 명이었고, 가장 많이 나온 불만은 무엇이었나요?",
    },
    LangDoc {
        lang: Lang::Es,
        doc: "# Club de Lectura de Fin de Semana: informe del primer año\n\nLa biblioteca municipal puso en marcha el Club de Lectura de Fin de Semana en enero para atraer a más adolescentes a la biblioteca fuera del horario escolar.\n\n## Método\n\nA lo largo de todo el año, desde enero y hasta el mes de diciembre, el personal de la biblioteca llevó un registro muy cuidadoso y detallado de la asistencia a todas y cada una de las sesiones, y además de eso también repartió al final de cada mes un breve cuestionario en papel con el fin de conocer lo que los propios participantes pensaban realmente sobre el club y sobre la manera en que se organizaba.\n\n## Resultados\n\nLa asistencia pasó de 120 participantes inscritos en enero a 310 en diciembre. La queja más frecuente fue que la biblioteca cierra a las 4 de la tarde los domingos, lo que acorta la sesión dominical.\n\nEl próximo año el club añadirá una visita mensual de un autor.\n",
        shorten: "Haz más conciso el párrafo de Método.",
        question: "¿Cuántos participantes había en diciembre y cuál fue la queja más común?",
    },
    LangDoc {
        lang: Lang::Fr,
        doc: "# Club de lecture du week-end : bilan de la première année\n\nLa bibliothèque municipale a lancé le Club de lecture du week-end en janvier pour attirer davantage d'adolescents à la bibliothèque en dehors des heures de cours.\n\n## Méthode\n\nTout au long de l'année entière, depuis le mois de janvier jusqu'au mois de décembre, le personnel de la bibliothèque a tenu un registre très attentif et minutieux de la présence à chacune des séances sans exception, et en plus de cela il a également distribué à la fin de chaque mois un court questionnaire papier afin de savoir ce que les participants eux-mêmes pensaient réellement du club et de la façon dont il était organisé.\n\n## Résultats\n\nLa fréquentation est passée de 120 participants inscrits en janvier à 310 en décembre. La plainte la plus fréquente concernait la fermeture de la bibliothèque à 16 heures le dimanche, ce qui écourte la séance du dimanche.\n\nL'année prochaine, le club ajoutera une rencontre mensuelle avec un auteur.\n",
        shorten: "Rends le paragraphe Méthode plus concis.",
        question: "Combien de participants y avait-il en décembre, et de quoi se plaignait-on le plus ?",
    },
    LangDoc {
        lang: Lang::De,
        doc: "# Wochenend-Leseclub: Bericht über das erste Jahr\n\nDie Stadtbibliothek hat den Wochenend-Leseclub im Januar gestartet, um mehr Jugendliche außerhalb der Schulzeit in die Bibliothek zu holen.\n\n## Methode\n\nWährend des gesamten Jahres, von Januar bis einschließlich Dezember, haben die Mitarbeiterinnen und Mitarbeiter der Bibliothek die Anwesenheit bei jeder einzelnen Sitzung sehr sorgfältig und genau protokolliert, und darüber hinaus haben sie außerdem am Ende jedes Monats einen kurzen Fragebogen auf Papier verteilt, um herauszufinden, was die Teilnehmenden selbst eigentlich über den Club und über die Art und Weise, wie er organisiert wurde, dachten.\n\n## Ergebnisse\n\nDie Teilnehmerzahl stieg von 120 angemeldeten Teilnehmenden im Januar auf 310 im Dezember. Die häufigste Beschwerde war, dass die Bibliothek sonntags um 16 Uhr schließt, wodurch die Sonntagssitzung verkürzt wird.\n\nIm nächsten Jahr kommt ein monatlicher Autorenbesuch hinzu.\n",
        shorten: "Formuliere den Absatz unter „Methode“ knapper.",
        question: "Wie viele Teilnehmende gab es im Dezember, und worüber wurde am häufigsten geklagt?",
    },
    LangDoc {
        lang: Lang::Ru,
        doc: "# Клуб чтения выходного дня: итоги первого года\n\nГородская библиотека открыла клуб чтения выходного дня в январе, чтобы привлечь в библиотеку больше подростков во внеурочное время.\n\n## Метод\n\nНа протяжении всего года, начиная с января и вплоть до самого декабря, сотрудники библиотеки очень внимательно и тщательно вели учёт посещаемости каждого без исключения занятия, а кроме того, в конце каждого месяца они также раздавали небольшую бумажную анкету, чтобы узнать, что сами участники на самом деле думают о клубе и о том, как он организован.\n\n## Результаты\n\nЧисло участников выросло со 120 зарегистрированных в январе до 310 в декабре. Чаще всего жаловались на то, что по воскресеньям библиотека закрывается в 16:00, из-за чего воскресное занятие приходится сокращать.\n\nВ следующем году в клубе появятся ежемесячные встречи с писателями.\n",
        shorten: "Сделай абзац в разделе «Метод» более лаконичным.",
        question: "Сколько участников было к декабрю и на что чаще всего жаловались?",
    },
    LangDoc {
        lang: Lang::Pt,
        doc: "# Clube de Leitura de Fim de Semana: relatório do primeiro ano\n\nA biblioteca municipal lançou o Clube de Leitura de Fim de Semana em janeiro para trazer mais adolescentes à biblioteca fora do horário escolar.\n\n## Método\n\nAo longo de todo o ano, desde janeiro e até o mês de dezembro, a equipe da biblioteca manteve um registro muito cuidadoso e detalhado da presença em todas as sessões, sem exceção, e além disso também distribuiu no fim de cada mês um breve questionário em papel com o objetivo de saber o que os próprios participantes realmente pensavam sobre o clube e sobre a maneira como ele era organizado.\n\n## Resultados\n\nA participação passou de 120 inscritos em janeiro para 310 em dezembro. A reclamação mais comum foi que a biblioteca fecha às 16h aos domingos, o que encurta a sessão de domingo.\n\nNo próximo ano, o clube vai acrescentar uma visita mensal de um autor.\n",
        shorten: "Deixe o parágrafo de Método mais conciso.",
        question: "Quantos participantes havia em dezembro e qual foi a reclamação mais comum?",
    },
    LangDoc {
        lang: Lang::Mixed,
        doc: "# Levis 迁移复盘\n\n三月份我们把 editor 从 Electron 迁移到了 Tauri，目标是减小安装包体积并加快冷启动。\n\n## 过程\n\n在整个迁移的过程当中，我们首先花了大约两周的时间把所有的 IPC 调用都逐一梳理了一遍，然后又把原本依赖 Node.js API 的那些模块一个一个地改写成 Rust command，与此同时还要保证 CI pipeline 在 macOS、Windows 和 Linux 三个平台上都能够正常地跑通，这个过程比我们一开始预想的要复杂得多。\n\n## 结果\n\n安装包从 180 MB 降到了 12 MB，冷启动时间从 2.1 秒降到 0.6 秒。最大的问题是 Linux 上 WebKitGTK 的渲染和 Chromium 不一致。\n\n下一步我们会给 WebView 加上视觉回归测试。\n",
        shorten: "把“过程”这一段改简洁一些。",
        question: "安装包体积和冷启动分别优化了多少？",
    },
];

pub fn lang_doc(lang: Lang) -> &'static LangDoc {
    LANG_DOCS
        .iter()
        .find(|d| d.lang == lang)
        .expect("doc for language")
}

/// The n-th body paragraph (0-based; headings skipped) - 0 intro, 1 Method,
/// 2 Findings, 3 the closing line.
pub fn para(doc: &str, n: usize) -> &str {
    doc.split("\n\n")
        .map(str::trim)
        .filter(|b| !b.is_empty() && !b.starts_with('#'))
        .nth(n)
        .expect("paragraph exists")
}

/// Every construct the editor round-trips: front matter, an alert, a table,
/// a task list, nested lists, inline and block math, a footnote, a link and
/// an image, fenced Python with a bug in it, Mermaid, and raw HTML.
pub const RICH_DOC: &str = r#"---
title: Sync engine notes
tags: [design, sync]
---

# Sync engine notes

> [!NOTE]
> These notes describe the version that shipped in March, and they are kept here so that anyone who joins the team later can understand why the sync engine works the way it does today.

## Status

| Component | Owner | Status |
| --- | --- | --- |
| Conflict resolver | Mia | In review |
| Search index | Tom | In progress |
| Offline queue | Ana | Done |

## Tasks

- [x] Write the migration
- [ ] Update the docs
- [ ] Benchmark on large files

## Design

The engine keeps a log of operations per document[^1]. Each client replays the log on top of its last snapshot, so the cost of opening a document is $O(n)$ in the number of operations since that snapshot. See the [protocol spec](https://example.com/spec) for the wire format.

- Storage
  - Snapshots every 500 operations
  - Logs compressed with zstd
- Transport
  - WebSocket with exponential backoff

The average replay time over $n$ samples is

$$
\bar{t} = \frac{1}{n} \sum_{i=1}^{n} t_i
$$

and the sample variance we report is

$$
s^2 = \frac{1}{n} \sum_{i=1}^{n} (t_i - \bar{t})^2
$$

```python
def average_replay_time(samples):
    total = 0
    for s in samples:
        total += s
    return total / (len(samples) - 1)
```

```mermaid
flowchart LR
    A[Client] --> B[Server]
    B --> C[Log store]
```

<details>
<summary>Why not CRDTs?</summary>

We evaluated CRDTs in 2023, but the memory overhead was too high for our largest documents.

</details>

![Architecture diagram](images/architecture.png)

[^1]: Operations are stored as JSON lines.
"#;

/// A Chinese counterpart for the structures most often edited in place.
pub const RICH_DOC_ZH: &str = r#"# 同步引擎笔记

## 状态

| 模块 | 负责人 | 状态 |
| --- | --- | --- |
| 冲突合并 | 小米 | 评审中 |
| 搜索索引 | 阿汤 | 开发中 |
| 离线队列 | 安娜 | 已完成 |

## 实现

```js
// 计算平均回放耗时（毫秒）
function averageReplayTime(samples) {
  let total = 0;
  for (let i = 1; i < samples.length; i++) {
    total += samples[i];
  }
  return total / samples.length;
}
```

每个客户端在最近一次快照的基础上回放日志，所以打开文档的开销是 $O(n)$。
"#;

/// Japanese task list for checking items off in place.
pub const TASKS_DOC_JA: &str = "# リリース準備\n\n- [x] 変更履歴を書く\n- [ ] スクリーンショットを更新する\n- [ ] ストアの説明文を見直す\n\n来週の水曜日に審査へ提出します。\n";
