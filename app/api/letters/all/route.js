export const runtime = "nodejs";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function DELETE(req) {
  try {
    // ✅ (اختیاری ولی بهتر) فقط ادمین اجازه داشته باشد
    // اگر سیستم auth داری اینجا چک کن. فعلاً ساده گذاشتم.

    // ✅ پاک کردن همه نامه‌ها
    const result = await prisma.letter.deleteMany({}); 
    // اگر مدل شما "letters" است، این خط را به prisma.letters.deleteMany تغییر بده

    return NextResponse.json({ ok: true, deleted: result.count });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e?.message || "delete_all_failed" },
      { status: 500 }
    );
  }
}
