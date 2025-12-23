    import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data, status = 200) {
  return NextResponse.json(data, { status });
}
function bad(message, status = 400) {
  return json({ error: message }, status);
}

export async function POST(req, ctx) {
  const idRaw = ctx?.params?.id;
  const letterId = Number(idRaw);
  if (!Number.isFinite(letterId) || letterId <= 0) return bad("invalid_letter_id");

  const body = await req.json().catch(() => ({}));
  const fileId = Number(body.file_id ?? body.fileId);
  if (!Number.isFinite(fileId) || fileId <= 0) return bad("invalid_file_id");

  const letter = await prisma.letter.findUnique({ where: { id: letterId } });
  if (!letter) return bad("letter_not_found", 404);

  const file = await prisma.uploadedFile.findUnique({ where: { id: fileId } });
  if (!file) return bad("file_not_found", 404);

  const prev = Array.isArray(letter.attachments) ? letter.attachments : [];
  const alreadyAttached = prev.some((x) => Number(x?.file_id) === file.id);
  if (alreadyAttached) return json({ ok: true, already: true });

  const next = [
    ...prev,
    {
      file_id: file.id,
      name: file.originalName,
      size: file.size,
      type: file.mimeType || "",
      url: file.url,
      attached_at: new Date().toISOString(),
    },
  ];

  const updated = await prisma.letter.update({
    where: { id: letterId },
    data: { attachments: next, hasAttachment: true },
  });

  return json({ ok: true, attachments: updated.attachments });
}
