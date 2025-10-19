import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

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

const DATA_DIR = path.join(__dirname, "data");
const BOOK_TXT = path.join(DATA_DIR, "book.txt");

// Разбивка на главы по заголовкам; если не нашли — рубим по ~7000 символов
function splitTextToChapters(fullText) {
  const lines = fullText.replace(/\r/g, "").split("\n");
  const blocks = [];
  let buf = [];
  const isHeader = (s) =>
    /^(глава|chapter)\b[\s\d.,\-:]*$/i.test(s.trim()) ||
    /^глава\s+\d+/i.test(s) ||
    /^chapter\s+\d+/i.test(s);

  for (const line of lines) {
    if (isHeader(line) && buf.length > 80) {
      blocks.push(buf.join("\n").trim());
      buf = [line];
    } else {
      buf.push(line);
    }
  }
  if (buf.length) blocks.push(buf.join("\n").trim());

  if (blocks.length <= 1) {
    const text = lines.join("\n");
    const size = 7000;
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

// Загружаем главы: если в data много .md/.txt — берём их по очереди; иначе читаем data/book.txt и режем
function loadChapters() {
  if (!fs.existsSync(DATA_DIR)) return [];
  const files = fs.readdirSync(DATA_DIR).filter(f => /\.(md|txt)$/i.test(f)).sort();

  if (files.length > 1) {
    return files.map((fname, i) => {
      const text = fs.readFileSync(path.join(DATA_DIR, fname), "utf8");
      const first = (text.split("\n").find(s => s.trim().length > 0) || "").trim();
      const title = first.replace(/^#\s*/, "").slice(0, 120) || `Часть ${i + 1}`;
      return { id: i + 1, filename: fname, title, text };
    });
  }

  if (fs.existsSync(BOOK_TXT)) {
    const text = fs.readFileSync(BOOK_TXT, "utf8");
    const parts = splitTextToChapters(text);
    return parts;
  }

  return [];
}

let CHAPTERS = loadChapters();

app.get("/health", (req, res) => res.json({ status: "ok", chapters: CHAPTERS.length }));

app.get("/toc", (req, res) => {
  res.json({ toc: CHAPTERS.map(({ id, title }) => ({ id, title })) });
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
    const idx = ch.text.toLowerCase().indexOf(needle);
    if (idx >= 0) {
      const start = Math.max(0, idx - 160);
      const end = Math.min(ch.text.length, idx + q.length + 160);
      const excerpt = ch.text.slice(start, end).replace(/\s+/g, " ").trim();
      hits.push({ chapterId: ch.id, title: ch.title, excerpt });
      if (hits.length >= limit) break;
    }
  }
  res.json({ result: hits });
});

app.post("/reload", (req, res) => {
  CHAPTERS = loadChapters();
  res.json({ reloaded: true, chapters: CHAPTERS.length });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Running on ${PORT}, chapters: ${CHAPTERS.length}`));

