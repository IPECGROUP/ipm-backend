import { readFile } from "node:fs/promises";
import path from "node:path";
import convertHeic from "heic-convert";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads", "payment-doc");
const HEIC_NAME = /^[a-z0-9-]+\.hei[cf]$/i;

function error(message, status) {
  return Response.json({ error: message }, { status });
}

// Most browsers cannot render HEIC files themselves. Keep the original intact
// and create the browser-friendly JPEG only for the preview response.
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const name = String(searchParams.get("name") || "");
  if (!HEIC_NAME.test(name)) return error("invalid_file", 400);

  try {
    const input = await readFile(path.join(UPLOAD_DIR, name));
    const image = await convertHeic({ buffer: input, format: "JPEG", quality: 0.9 });

    return new Response(image, {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "private, max-age=86400",
      },
    });
  } catch (cause) {
    console.error("Unable to create HEIC preview", cause);
    return error("preview_unavailable", 422);
  }
}
