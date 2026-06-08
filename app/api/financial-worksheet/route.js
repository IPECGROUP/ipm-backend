import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { randomUUID } from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let ensureSchemaPromise = null;

function json(data, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

function trimString(value) {
  return String(value ?? "").trim();
}

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeProjectId(value) {
  const id = Number(trimString(value));
  return Number.isInteger(id) && id > 0 ? id : null;
}

function mapRow(row) {
  const payload = plainObject(row?.payload);
  return {
    ...payload,
    id: row?.id || payload.id || "",
    kind: row?.kind || payload.kind || "statement",
    project_id: row?.project_id == null ? payload.project_id || "" : String(row.project_id),
    contract_id: row?.contract_id || payload.contract_id || "",
    created_at: row?.created_at || payload.created_at || "",
    updated_at: row?.updated_at || payload.updated_at || "",
  };
}

async function ensureSchema() {
  if (!ensureSchemaPromise) {
    ensureSchemaPromise = (async () => {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "financial_worksheet" (
          "id" TEXT NOT NULL,
          "project_id" INTEGER,
          "contract_id" TEXT,
          "kind" TEXT NOT NULL DEFAULT 'statement',
          "payload" JSONB NOT NULL DEFAULT '{}'::jsonb,
          "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          CONSTRAINT "financial_worksheet_pkey" PRIMARY KEY ("id")
        )
      `);
      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "financial_worksheet_project_id_idx"
        ON "financial_worksheet"("project_id")
      `);
      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "financial_worksheet_kind_idx"
        ON "financial_worksheet"("kind")
      `);
    })();
  }
  return ensureSchemaPromise;
}

export async function GET(request) {
  try {
    await ensureSchema();
    const { searchParams } = new URL(request.url);
    const projectId = normalizeProjectId(searchParams.get("project_id"));
    const kind = trimString(searchParams.get("kind") || "statement") || "statement";

    const rows = projectId
      ? await prisma.$queryRaw`
          SELECT "id", "project_id", "contract_id", "kind", "payload", "created_at", "updated_at"
          FROM "financial_worksheet"
          WHERE "project_id" = ${projectId}
            AND "kind" = ${kind}
          ORDER BY "created_at" DESC
        `
      : await prisma.$queryRaw`
          SELECT "id", "project_id", "contract_id", "kind", "payload", "created_at", "updated_at"
          FROM "financial_worksheet"
          WHERE "kind" = ${kind}
          ORDER BY "created_at" DESC
        `;

    return json({ items: (Array.isArray(rows) ? rows : []).map(mapRow) });
  } catch (error) {
    console.error("financial_worksheet_get_error", error);
    return json({ error: "financial_worksheet_get_failed" }, 500);
  }
}

export async function POST(request) {
  try {
    await ensureSchema();
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") return json({ error: "invalid_payload" }, 400);

    const id = trimString(body.id) || randomUUID();
    const projectId = normalizeProjectId(body.project_id ?? body.projectId);
    if (!projectId) return json({ error: "project_id_required" }, 400);

    const kind = trimString(body.kind || "statement") || "statement";
    const contractId = trimString(body.contract_id ?? body.contractId);
    const payload = {
      ...body,
      id,
      kind,
      project_id: String(projectId),
      contract_id: contractId,
      updated_at: new Date().toISOString(),
    };

    const rows = await prisma.$queryRaw`
      INSERT INTO "financial_worksheet" (
        "id",
        "project_id",
        "contract_id",
        "kind",
        "payload"
      ) VALUES (
        ${id},
        ${projectId},
        ${contractId || null},
        ${kind},
        ${JSON.stringify(payload)}::jsonb
      )
      ON CONFLICT ("id") DO UPDATE SET
        "project_id" = EXCLUDED."project_id",
        "contract_id" = EXCLUDED."contract_id",
        "kind" = EXCLUDED."kind",
        "payload" = EXCLUDED."payload",
        "updated_at" = NOW()
      RETURNING "id", "project_id", "contract_id", "kind", "payload", "created_at", "updated_at"
    `;

    return json({ ok: true, item: mapRow(Array.isArray(rows) ? rows[0] : null) });
  } catch (error) {
    console.error("financial_worksheet_post_error", error);
    return json({ error: "financial_worksheet_save_failed" }, 500);
  }
}

export async function DELETE(request) {
  try {
    await ensureSchema();
    const { searchParams } = new URL(request.url);
    const id = trimString(searchParams.get("id"));
    if (!id) return json({ error: "id_required" }, 400);

    await prisma.$executeRaw`
      DELETE FROM "financial_worksheet"
      WHERE "id" = ${id}
    `;

    return json({ ok: true });
  } catch (error) {
    console.error("financial_worksheet_delete_error", error);
    return json({ error: "financial_worksheet_delete_failed" }, 500);
  }
}
