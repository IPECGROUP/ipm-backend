// app/api/tags/route.js
export const runtime = "nodejs";

import { prisma } from "../../../lib/prisma";

function json(status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function normStr(v) {
  return String(v ?? "").trim();
}

// GET /api/tags?scope=letters
export async function GET(request) {
  try {
    const url = new URL(request.url);
    const scope = normStr(url.searchParams.get("scope"));

    // اگر scope نداشت، برای سازگاری با کدهای قدیمی همون items برچسب‌ها رو بده
    if (!scope) {
      const items = await prisma.tag.findMany({ orderBy: { label: "asc" } });
      return Response.json({ items });
    }

    const [categories, tags] = await Promise.all([
      prisma.tagCategory.findMany({
        where: { scope },
        orderBy: { label: "asc" },
        select: { id: true, label: true, scope: true },
      }),
      prisma.tag.findMany({
        where: { scope },
        orderBy: { label: "asc" },
        select: { id: true, label: true, scope: true, categoryId: true },
      }),
    ]);

    // فرانت شما category_id می‌خواد
    const tagsOut = (tags || []).map((t) => ({
      id: t.id,
      label: t.label,
      scope: t.scope,
      category_id: t.categoryId,
    }));

    return Response.json({ categories, tags: tagsOut });
  } catch (e) {
    console.error("tags_get_error", e);
    return json(500, { error: "internal_error" });
  }
}

// POST /api/tags
// body:
//  - category: { scope:"letters", type:"category", label:"..." }
//  - tag:      { scope:"letters", type:"tag", category_id: 1, label:"..." }
export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const type = normStr(body.type);
    const scope = normStr(body.scope);
    const label = normStr(body.label);

    if (!scope) return json(400, { error: "scope_required" });
    if (!type) return json(400, { error: "type_required" });
    if (!label) return json(400, { error: "label_required" });

    if (type === "category") {
      const row = await prisma.tagCategory.create({
        data: { scope, label },
        select: { id: true, label: true, scope: true },
      });
      return Response.json({ item: row, id: row.id });
    }

    if (type === "tag") {
      const categoryId = Number(body.category_id ?? body.categoryId);
      if (!categoryId || !Number.isFinite(categoryId)) {
        return json(400, { error: "category_id_required" });
      }

      // اطمینان از اینکه دسته‌بندی متعلق به همین scope هست
      const cat = await prisma.tagCategory.findFirst({
        where: { id: categoryId, scope },
        select: { id: true },
      });
      if (!cat) return json(400, { error: "invalid_category" });

      const row = await prisma.tag.create({
        data: { scope, label, categoryId },
        select: { id: true, label: true, scope: true, categoryId: true },
      });

      return Response.json({
        item: { id: row.id, label: row.label, scope: row.scope, category_id: row.categoryId },
        id: row.id,
      });
    }

    return json(400, { error: "invalid_type" });
  } catch (e) {
    // unique constraint
    if (e?.code === "P2002") {
      return json(409, { error: "duplicate" });
    }
    console.error("tags_post_error", e);
    return json(500, { error: "internal_error" });
  }
}

// PATCH /api/tags
export async function PATCH(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const id = Number(body.id);
    const type = normStr(body.type || "tag");
    const scope = normStr(body.scope);
    const label = normStr(body.label);

    if (!id || !Number.isFinite(id)) return json(400, { error: "invalid_id" });
    if (!label) return json(400, { error: "label_required" });

    if (type === "category") {
      if (!scope) return json(400, { error: "scope_required" });
      const row = await prisma.tagCategory.update({
        where: { id },
        data: { scope, label },
        select: { id: true, label: true, scope: true },
      });
      return Response.json({ ok: true, item: row });
    }

    if (type === "tag") {
      if (!scope) return json(400, { error: "scope_required" });

      const data = { scope, label };
      const categoryId =
        body.category_id != null || body.categoryId != null ? Number(body.category_id ?? body.categoryId) : null;

      if (categoryId && Number.isFinite(categoryId)) {
        const cat = await prisma.tagCategory.findFirst({
          where: { id: categoryId, scope },
          select: { id: true },
        });
        if (!cat) return json(400, { error: "invalid_category" });
        data.categoryId = categoryId;
      }

      const row = await prisma.tag.update({
        where: { id },
        data,
        select: { id: true, label: true, scope: true, categoryId: true },
      });

      return Response.json({
        ok: true,
        item: { id: row.id, label: row.label, scope: row.scope, category_id: row.categoryId },
      });
    }

    return json(400, { error: "invalid_type" });
  } catch (e) {
    if (e?.code === "P2002") return json(409, { error: "duplicate" });
    console.error("tags_patch_error", e);
    return json(500, { error: "internal_error" });
  }
}

// DELETE /api/tags
// - حذف تگ:      { id }
// - حذف دسته‌بندی: { id, type:"category" }
export async function DELETE(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const id = Number(body.id);
    const type = normStr(body.type || "tag"); // default: tag delete

    if (!id || !Number.isFinite(id)) {
      return json(400, { error: "invalid_id" });
    }

    // ✅ حذف دسته‌بندی + همه‌ی تگ‌های زیرش
    if (type === "category") {
      // اگر خواستی سخت‌گیرانه‌تر باشه می‌تونی scope هم بگیری و چک کنی؛ فعلاً کم‌تغییر
      const cat = await prisma.tagCategory.findUnique({
        where: { id },
        select: { id: true, label: true, scope: true },
      });
      if (!cat) return json(404, { error: "category_not_found" });

      await prisma.$transaction([
        prisma.tag.deleteMany({ where: { categoryId: id } }),
        prisma.tagCategory.delete({ where: { id } }),
      ]);

      return Response.json({
        ok: true,
        deleted: "category",
        item: { id: cat.id, label: cat.label, scope: cat.scope },
      });
    }

    // ✅ حذف تگ (رفتار قبلی)
    const row = await prisma.tag.delete({
      where: { id },
      select: { id: true, label: true, scope: true, categoryId: true },
    });

    return Response.json({
      ok: true,
      deleted: "tag",
      item: { id: row.id, label: row.label, scope: row.scope, category_id: row.categoryId },
    });
  } catch (e) {
    console.error("tags_delete_error", e);
    return json(500, { error: "internal_error" });
  }
}
