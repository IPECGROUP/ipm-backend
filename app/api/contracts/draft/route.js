import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let ensureContractDraftSchemaPromise = null;

function json(data, status = 200) {
  return NextResponse.json(data, { status });
}

function bad(error, status = 400) {
  return json({ error }, status);
}

async function readJsonSafely(request) {
  const text = await request.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("invalid_json");
  }
}

function trimString(value) {
  return String(value ?? "").trim();
}

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function mapDraft(row) {
  if (!row) return null;
  const draftKey = row.draftKey ?? row.draft_key;
  const contractId = row.contractId ?? row.contract_id;
  const lastSavedSection = row.lastSavedSection ?? row.last_saved_section;
  const createdAt = row.createdAt ?? row.created_at;
  const updatedAt = row.updatedAt ?? row.updated_at;

  return {
    draftKey: draftKey || "",
    contractId: contractId || "",
    payload: plainObject(row.payload),
    lastSavedSection: lastSavedSection || "",
    createdAt,
    updatedAt,
  };
}

function mapDatabaseError(error) {
  if (!error) return null;

  if (error instanceof Prisma.PrismaClientInitializationError) {
    const message = String(error?.message || "").toLowerCase();
    if (message.includes("authentication failed")) return { error: "database_auth_failed", status: 503 };
    if (message.includes("can't reach database server")) return { error: "database_unreachable", status: 503 };
    return { error: "database_init_failed", status: 503 };
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2021" || error.code === "P2022") return { error: "contract_drafts_table_not_ready", status: 503 };
  }

  const message = String(error?.message || "").toLowerCase();
  if (message.includes("can't reach database server")) return { error: "database_unreachable", status: 503 };
  if (message.includes("authentication failed")) return { error: "database_auth_failed", status: 503 };
  if (message.includes("permission denied")) return { error: "database_permission_denied", status: 503 };

  return null;
}

async function ensureContractDraftSchema() {
  if (ensureContractDraftSchemaPromise) return ensureContractDraftSchemaPromise;

  ensureContractDraftSchemaPromise = (async () => {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "contract_information_drafts" (
        "draft_key" TEXT NOT NULL,
        "contract_id" TEXT,
        "payload" JSONB NOT NULL DEFAULT '{}'::jsonb,
        "last_saved_section" VARCHAR(40),
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "contract_information_drafts_pkey" PRIMARY KEY ("draft_key")
      );
    `);

    await prisma.$executeRawUnsafe(`
      ALTER TABLE "contract_information_drafts"
      ADD COLUMN IF NOT EXISTS "contract_id" TEXT,
      ADD COLUMN IF NOT EXISTS "payload" JSONB NOT NULL DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS "last_saved_section" VARCHAR(40),
      ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
    `);

    await prisma.$executeRawUnsafe(`
      UPDATE "contract_information_drafts"
      SET
        "payload" = COALESCE("payload", '{}'::jsonb),
        "created_at" = COALESCE("created_at", CURRENT_TIMESTAMP),
        "updated_at" = COALESCE("updated_at", CURRENT_TIMESTAMP);
    `);

    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "contract_information_drafts_contract_id_idx"
      ON "contract_information_drafts"("contract_id");
    `);
  })().catch((error) => {
    ensureContractDraftSchemaPromise = null;
    throw error;
  });

  return ensureContractDraftSchemaPromise;
}

async function getDraft(draftKey) {
  const rows = await prisma.$queryRaw`
    SELECT
      "draft_key" AS "draftKey",
      "contract_id" AS "contractId",
      "payload",
      "last_saved_section" AS "lastSavedSection",
      "created_at" AS "createdAt",
      "updated_at" AS "updatedAt"
    FROM "contract_information_drafts"
    WHERE "draft_key" = ${draftKey}
    LIMIT 1
  `;
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function upsertDraft(data) {
  const rows = await prisma.$queryRaw`
    INSERT INTO "contract_information_drafts" (
      "draft_key",
      "contract_id",
      "payload",
      "last_saved_section",
      "created_at",
      "updated_at"
    )
    VALUES (
      ${data.draftKey},
      ${data.contractId},
      ${JSON.stringify(data.payload)}::jsonb,
      ${data.lastSavedSection},
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )
    ON CONFLICT ("draft_key") DO UPDATE SET
      "contract_id" = EXCLUDED."contract_id",
      "payload" = EXCLUDED."payload",
      "last_saved_section" = EXCLUDED."last_saved_section",
      "updated_at" = CURRENT_TIMESTAMP
    RETURNING
      "draft_key" AS "draftKey",
      "contract_id" AS "contractId",
      "payload",
      "last_saved_section" AS "lastSavedSection",
      "created_at" AS "createdAt",
      "updated_at" AS "updatedAt"
  `;
  return Array.isArray(rows) ? rows[0] || null : null;
}

export async function GET(request) {
  try {
    await ensureContractDraftSchema();

    const url = new URL(request.url);
    const draftKey = trimString(url.searchParams.get("draftKey") || url.searchParams.get("draft_key"));
    if (!draftKey) return bad("draft_key_required");

    const item = await getDraft(draftKey);
    if (!item) return json({ item: null });

    return json({ item: mapDraft(item) });
  } catch (error) {
    const mapped = mapDatabaseError(error);
    if (mapped) return bad(mapped.error, mapped.status);
    console.error("contract_draft_get_error", error);
    return bad("internal_error", 500);
  }
}

export async function POST(request) {
  try {
    await ensureContractDraftSchema();

    const body = await readJsonSafely(request);
    const draftKey = trimString(body.draftKey ?? body.draft_key);
    if (!draftKey) return bad("draft_key_required");

    const item = await upsertDraft({
      draftKey,
      contractId: trimString(body.contractId ?? body.contract_id) || null,
      payload: plainObject(body.payload),
      lastSavedSection: trimString(body.lastSavedSection ?? body.last_saved_section) || null,
    });

    return json({ ok: true, item: mapDraft(item) });
  } catch (error) {
    if (error?.message === "invalid_json") return bad("invalid_json");
    const mapped = mapDatabaseError(error);
    if (mapped) return bad(mapped.error, mapped.status);
    console.error("contract_draft_post_error", error);
    return bad("internal_error", 500);
  }
}

export async function DELETE(request) {
  try {
    await ensureContractDraftSchema();

    const url = new URL(request.url);
    let draftKey = trimString(url.searchParams.get("draftKey") || url.searchParams.get("draft_key"));
    if (!draftKey) {
      const body = await readJsonSafely(request);
      draftKey = trimString(body.draftKey ?? body.draft_key);
    }
    if (!draftKey) return bad("draft_key_required");

    await prisma.$executeRaw`
      DELETE FROM "contract_information_drafts"
      WHERE "draft_key" = ${draftKey}
    `;

    return json({ ok: true, draftKey });
  } catch (error) {
    if (error?.message === "invalid_json") return bad("invalid_json");
    const mapped = mapDatabaseError(error);
    if (mapped) return bad(mapped.error, mapped.status);
    console.error("contract_draft_delete_error", error);
    return bad("internal_error", 500);
  }
}
