import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

const DOCS_DIR = process.env.WORD_DOCS_DIR
  ? path.resolve(process.env.WORD_DOCS_DIR)
  : path.join(process.cwd(), "public", "word-docs");

const INDEX_FILE = path.join(DOCS_DIR, "index.json");

function nowIso() {
  return new Date().toISOString();
}

function normalizeTitle(raw) {
  const t = String(raw || "").replace(/\s+/g, " ").trim();
  if (!t) return "New document";
  return t.slice(0, 180);
}

function safeId(raw) {
  return String(raw || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 120);
}

function makeId() {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID().replace(/-/g, "");
  }
  return `${Date.now()}${Math.random().toString(16).slice(2, 10)}`;
}

async function ensureStore() {
  await fs.mkdir(DOCS_DIR, { recursive: true });
  try {
    await fs.access(INDEX_FILE);
  } catch {
    await fs.writeFile(INDEX_FILE, "[]", "utf8");
  }
}

async function readIndex() {
  await ensureStore();
  try {
    const raw = await fs.readFile(INDEX_FILE, "utf8");
    const parsed = JSON.parse(raw || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

async function writeIndex(items) {
  await ensureStore();
  const tmp = `${INDEX_FILE}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(items, null, 2), "utf8");
  await fs.rename(tmp, INDEX_FILE);
}

export function getWordDocPath(id) {
  const sid = safeId(id);
  if (!sid) return "";
  return path.join(DOCS_DIR, `${sid}.docx`);
}

export async function listWordDocs() {
  const items = await readIndex();
  return items
    .map((x) => ({
      id: safeId(x?.id),
      title: normalizeTitle(x?.title),
      createdAt: String(x?.createdAt || ""),
      updatedAt: String(x?.updatedAt || ""),
      size: Number(x?.size || 0) || 0,
    }))
    .filter((x) => x.id)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

export async function getWordDoc(id) {
  const sid = safeId(id);
  if (!sid) return null;
  const items = await readIndex();
  const hit = items.find((x) => safeId(x?.id) === sid);
  if (!hit) return null;
  return {
    id: sid,
    title: normalizeTitle(hit?.title),
    createdAt: String(hit?.createdAt || ""),
    updatedAt: String(hit?.updatedAt || ""),
    size: Number(hit?.size || 0) || 0,
  };
}

export async function createWordDocMeta(title) {
  const items = await readIndex();
  const id = makeId();
  const now = nowIso();
  const next = {
    id,
    title: normalizeTitle(title),
    createdAt: now,
    updatedAt: now,
    size: 0,
  };
  items.unshift(next);
  await writeIndex(items);
  return next;
}

export async function updateWordDocMeta(id, patch = {}) {
  const sid = safeId(id);
  if (!sid) return null;
  const items = await readIndex();
  const idx = items.findIndex((x) => safeId(x?.id) === sid);
  if (idx < 0) return null;

  const cur = items[idx] || {};
  const next = {
    ...cur,
    title: patch.title != null ? normalizeTitle(patch.title) : normalizeTitle(cur.title),
    updatedAt: patch.updatedAt || nowIso(),
    size: patch.size != null ? Number(patch.size || 0) : Number(cur.size || 0),
  };
  items[idx] = next;
  await writeIndex(items);
  return {
    id: sid,
    title: normalizeTitle(next.title),
    createdAt: String(next.createdAt || ""),
    updatedAt: String(next.updatedAt || ""),
    size: Number(next.size || 0) || 0,
  };
}

export async function deleteWordDoc(id) {
  const sid = safeId(id);
  if (!sid) return false;
  const items = await readIndex();
  const next = items.filter((x) => safeId(x?.id) !== sid);
  if (next.length === items.length) return false;
  await writeIndex(next);
  return true;
}
