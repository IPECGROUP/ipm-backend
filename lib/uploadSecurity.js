import path from "node:path";

// Keep uploaded content deliberately boring: no HTML, SVG, JavaScript, PHP or
// other server-executable formats are accepted, even when their MIME type lies.
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

const DOCUMENT_EXTENSIONS = new Set([".pdf", ".doc", ".docx", ".rtf", ".xls", ".xlsx", ".xlsm", ".csv"]);
const PAYMENT_EXTENSIONS = new Set([...DOCUMENT_EXTENSIONS, ".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif"]);
const MIME_BY_EXTENSION = {
  ".pdf": "application/pdf", ".doc": "application/msword", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".rtf": "application/rtf", ".xls": "application/vnd.ms-excel", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xlsm": "application/vnd.ms-excel.sheet.macroEnabled.12", ".csv": "text/csv", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".png": "image/png", ".webp": "image/webp", ".heic": "image/heic", ".heif": "image/heif",
};

export function safeOriginalName(value) {
  const name = String(value || "file").replace(/[\\/\0?%#*:|"<>]/g, "_").trim();
  return (name || "file").slice(-180);
}

function starts(buffer, text) { return buffer.subarray(0, text.length).equals(Buffer.from(text)); }
function isZip(buffer) { return buffer.length >= 4 && (starts(buffer, "PK\x03\x04") || starts(buffer, "PK\x05\x06") || starts(buffer, "PK\x07\x08")); }
function isOle(buffer) { return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])); }
function looksLikeText(buffer) { return !buffer.subarray(0, Math.min(buffer.length, 4096)).includes(0); }

export function validateUpload({ name, size, buffer, profile = "documents" }) {
  const originalName = safeOriginalName(name);
  const extension = path.extname(originalName).toLowerCase();
  const allowed = profile === "payment" ? PAYMENT_EXTENSIONS : DOCUMENT_EXTENSIONS;
  if (!allowed.has(extension)) return { ok: false, error: "unsupported_file_type" };
  if (!Number.isFinite(size) || size <= 0 || size > MAX_UPLOAD_BYTES) return { ok: false, error: "file_too_large" };
  if (!Buffer.isBuffer(buffer) || !buffer.length) return { ok: false, error: "invalid_file_content" };

  let valid = false;
  if (extension === ".pdf") valid = starts(buffer, "%PDF-");
  else if ([".doc", ".xls"].includes(extension)) valid = isOle(buffer);
  else if ([".docx", ".xlsx", ".xlsm"].includes(extension)) valid = isZip(buffer);
  else if (extension === ".png") valid = buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  else if ([".jpg", ".jpeg"].includes(extension)) valid = buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  else if (extension === ".webp") valid = starts(buffer, "RIFF") && buffer.subarray(8, 12).equals(Buffer.from("WEBP"));
  else if ([".heic", ".heif"].includes(extension)) valid = buffer.length >= 12 && buffer.subarray(4, 8).equals(Buffer.from("ftyp"));
  else if ([".rtf", ".csv"].includes(extension)) valid = looksLikeText(buffer) && (extension !== ".rtf" || /^\s*\{\\rtf/i.test(buffer.toString("utf8", 0, 64)));
  if (!valid) return { ok: false, error: "file_content_does_not_match_type" };
  return { ok: true, originalName, extension, mimeType: MIME_BY_EXTENSION[extension] || "application/octet-stream" };
}
