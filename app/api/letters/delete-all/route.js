export const runtime = "nodejs";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

const ADMIN_USER = "marandi";
const ADMIN_PASS = "1234";

function isAuthorized(req) {
  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Basic ")) return false;

  try {
    const base64 = auth.slice(6).trim();
    const decoded = Buffer.from(base64, "base64").toString("utf8");
    const [u, p] = decoded.split(":");
    return u === ADMIN_USER && p === ADMIN_PASS;
  } catch {
    return false;
  }
}

export async function DELETE(req) {
  try {
    if (!isAuthorized(req)) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    const result = await prisma.letter.deleteMany({});
    return NextResponse.json({ ok: true, deleted: result.count });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e?.message || "delete_all_failed" },
      { status: 500 }
    );
  }
}
