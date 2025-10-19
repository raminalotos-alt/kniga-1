import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

// pdf-parse — CommonJS, подключаем через createRequire
const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());

// CORS для OpenAI Actions
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, OpenAI-Beta");
  if (req.method === "OPTIONS") return res.status(200).end();
  next();
});

// ---------- загрузка и разбиение PDF ----------
const PDF_PATH = path.join(__dirname, "data", "book.pdf");

// Делим текст на главы по ключ. словам или по размеру блоков
function splitIntoChapters(fullText) {
  const lines = fullText.replace(/\r/g, "").split("\n");
  const blocks = [];
  let buf = [];

  const isChapterHeader = (s) =>
    /^(глава|chapter)\b[\s\d.,\-:]*$/i.test(s.trim()) ||
    /^глава\s+\d+/i.test(s) ||
    /^chapter\s+\d+/i.test(s);

  for (const line of lines) {
    if (isChapterHeader(line) && buf.length > 80) { // новая глава, если буфер уже есть
      blocks.push(buf.join("\n").trim());
      buf = [line];
    } else {
      buf.push(line);
    }
  }
  if (buf.length) blocks.push(buf.join("\n").trim());

  // если “глав” не нашлось — режем каждые ~5000 символов
  if (blocks.length <= 1) {
    const text = lines.join("\n");
    const size = 5000;
    const parts = [];
    for (let i = 0; i < text.length; i += size) {
      parts.push(text.slice(i, i + size));
    }
    return parts.map((t, i) => ({ id: i + 1, title: `Часть ${i + 1}`, text: t }));
  }

  return blocks.map((t, i) => {
    const first = (t.split("\n").find(s => s.trim().length > 0) || "").trim();
    const title = first.length < 120 ? first.replace(/^#\s*/, "") : `Глава ${i + 1}`;
    return { id: i + 1, title, text: t };
  });
}

let CHAPTERS = [];
let META = { pages: 0, textLength: 0 };

async function loadPdf() {
  const data = fs.readFileSync(PDF_PATH);
  const result = await pdfParse(data); // { text, numpages, info, ... }
  META.pages = result.numpages || 0;
  META.textLength = result.text.length;
  CHAPTERS = splitIntoChapters(result.text);
  console.log(`PDF loaded: pages=${META.pages}, chapters=${CHAPTERS.length}`);
}
await loadPdf();

// ---------- эндпоинты ----------
app.get("/health", (req, res) => res.json({ status: "ok", pages: META.pages, chapters: CHAPTERS.length }));

app.get("/toc", (req, res) => {
  res.json({ toc: CHAPTERS.map(c => ({ id: c.id, title: c.title })) });
});

app.get("/chapter", (req, res) => {
  const id = Number(req.query.id);
  const ch = CHAPTERS.find(c => c.id === id);
  if (!ch) return res.status(404).json({ error: "not_found" });
  res.json({ id: ch.id, title: ch.title, text: ch.text });
});

app.post("/search", (req, res) => {
  const q = String(req.body?.query || "").trim();
  const limit = Math.max(1, Math.min(50, Number(req.body?.limit ?? 10)));
  if (!q) return res.status(400).json({ error: "bad_request", detail: "field 'query' is required" });
  const needle = q.toLowerCase();

  const hits = [];
  for (const ch of CHAPTERS) {
    const where = ch.text.toLowerCase().indexOf(needle);
    if (where >= 0) {
      const start = Math.max(0, where - 160);
      const end = Math.min(ch.text.length, where + q.length + 160);
      const excerpt = ch.text.slice(start, end).replace(/\s+/g, " ").trim();
      hits.push({ chapterId: ch.id, title: ch.title, excerpt });
      if (hits.length >= limit) break;
    }
  }
  res.json({ result: hits });
});

// Перечитать PDF без деплоя (если заменишь файл)
app.post("/reload", async (req, res) => {
  try {
    await loadPdf();
    res.json({ reloaded: true, chapters: CHAPTERS.length });
  } catch (e) {
    res.status(500).json({ error: "reload_failed", detail: String(e) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Running on ${PORT} (chapters=${CHAPTERS.length})`));
