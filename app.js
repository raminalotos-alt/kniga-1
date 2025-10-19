// ===== УТИЛИТЫ ДЛЯ ПОИСКА =====
function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(s) {
  return normalize(s)
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(" ")
    .filter(Boolean);
}

function makeSnippet(text, start, end, pad = 120) {
  const beg = Math.max(0, start - pad);
  const fin = Math.min(text.length, end + pad);
  let snip = text.slice(beg, fin).replace(/\s+/g, " ").trim();
  if (beg > 0) snip = "… " + snip;
  if (fin < text.length) snip = snip + " …";
  return snip;
}

// Возвращает {score, posStart, posEnd} для лучшего вхождения
function scoreMatch(hayRaw, needleRaw, terms) {
  const hay = normalize(hayRaw);
  const needle = normalize(needleRaw);

  // 1) точное вхождение фразы (самый высокий вес)
  const idxPhrase = hay.indexOf(needle);
  if (needle && idxPhrase >= 0) {
    return { score: 100 + needle.length, posStart: idxPhrase, posEnd: idxPhrase + needle.length };
  }

  // 2) совпадения по словам (каждый токен даёт вес)
  let score = 0;
  let firstPos = -1;
  for (const t of terms) {
    if (!t) continue;
    const re = new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    const m = hay.match(re);
    if (m) {
      score += Math.min(20, t.length * 2); // слово побольше — вес побольше
      if (firstPos < 0) firstPos = m.index;
    }
  }
  if (score > 0) {
    const span = Math.min(hay.length, (firstPos >= 0 ? firstPos : 0) + 60);
    return { score, posStart: Math.max(0, (firstPos >= 0 ? firstPos : 0)), posEnd: span };
  }

  return { score: 0, posStart: -1, posEnd: -1 };
}

// =====/search с нормализацией и скорингом=====
app.post("/search", (req, res) => {
  const q = String(req.body?.query || "").trim();
  const limit = Math.max(1, Math.min(50, Number(req.body?.limit ?? 10)));
  if (!q) return res.status(400).json({ error: "bad_request", detail: "field 'query' is required" });

  const qNorm = normalize(q);
  const terms = tokenize(q);

  const hits = [];

  for (const ch of CHAPTERS) {
    const { text, title, id } = ch;
    const { score, posStart, posEnd } = scoreMatch(text, qNorm, terms);
    if (score > 0) {
      hits.push({
        chapterId: id,
        title,
        score,
        excerpt: makeSnippet(text, posStart, posEnd),
      });
    }
  }

  // если ничего не нашли — пробуем искать по числам/ключам (например, из "число 19" возьмём 19)
  if (hits.length === 0) {
    const nums = (q.match(/\d+/g) || []).slice(0, 2);
    for (const ch of CHAPTERS) {
      for (const n of nums) {
        const idx = normalize(ch.text).indexOf(n);
        if (idx >= 0) {
          hits.push({
            chapterId: ch.id,
            title: ch.title,
            score: 5,
            excerpt: makeSnippet(ch.text, idx, idx + String(n).length),
          });
          break;
        }
      }
    }
  }

  hits.sort((a, b) => b.score - a.score);
  res.json({ result: hits.slice(0, limit) });
});
