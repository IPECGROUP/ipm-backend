import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DOCUMENT_TYPES = new Set(["main", "sub", "appendix"]);

let ensureContractSchemaPromise = null;

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

function parseOptionalProjectId(value) {
  const text = trimString(value);
  if (!text) return null;
  const id = Number(text);
  return Number.isInteger(id) && id > 0 ? id : undefined;
}

function normalizeDocumentType(value) {
  const type = trimString(value || "main");
  return DOCUMENT_TYPES.has(type) ? type : "";
}

function normalizeId(value) {
  const id = trimString(value);
  return id || `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function mapRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.projectId == null ? "" : String(row.projectId),
    documentType: row.documentType || "main",
    contractNo: row.contractNo || "",
    parentContractId: row.parentContractId || "",
    relatedLetterId: row.relatedLetterId || "",
    general: plainObject(row.general),
    calendar: plainObject(row.calendar),
    technical: plainObject(row.technical),
    financial: plainObject(row.financial),
    insurance: plainObject(row.insurance),
    lastSavedSection: row.lastSavedSection || "",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
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
    if (error.code === "P2021" || error.code === "P2022") return { error: "contracts_table_not_ready", status: 503 };
    if (error.code === "P2003") return { error: "invalid_relation_reference", status: 400 };
    if (error.code === "P2025") return { error: "not_found", status: 404 };
  }

  const message = String(error?.message || "").toLowerCase();
  if (message.includes("can't reach database server")) return { error: "database_unreachable", status: 503 };
  if (message.includes("authentication failed")) return { error: "database_auth_failed", status: 503 };
  if (message.includes("permission denied")) return { error: "database_permission_denied", status: 503 };

  return null;
}

async function ensureContractSchema() {
  if (ensureContractSchemaPromise) return ensureContractSchemaPromise;

  ensureContractSchemaPromise = (async () => {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "contract_information" (
        "id" TEXT NOT NULL,
        "project_id" INTEGER,
        "document_type" VARCHAR(20) NOT NULL DEFAULT 'main',
        "contract_no" TEXT,
        "parent_contract_id" TEXT,
        "related_letter_id" TEXT,
        "general" JSONB NOT NULL DEFAULT '{}'::jsonb,
        "calendar" JSONB NOT NULL DEFAULT '{}'::jsonb,
        "technical" JSONB NOT NULL DEFAULT '{}'::jsonb,
        "financial" JSONB NOT NULL DEFAULT '{}'::jsonb,
        "insurance" JSONB NOT NULL DEFAULT '{}'::jsonb,
        "last_saved_section" VARCHAR(40),
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "contract_information_pkey" PRIMARY KEY ("id")
      );
    `);

    await prisma.$executeRawUnsafe(`
      ALTER TABLE "contract_information"
      ADD COLUMN IF NOT EXISTS "project_id" INTEGER,
      ADD COLUMN IF NOT EXISTS "document_type" VARCHAR(20) NOT NULL DEFAULT 'main',
      ADD COLUMN IF NOT EXISTS "contract_no" TEXT,
      ADD COLUMN IF NOT EXISTS "parent_contract_id" TEXT,
      ADD COLUMN IF NOT EXISTS "related_letter_id" TEXT,
      ADD COLUMN IF NOT EXISTS "general" JSONB NOT NULL DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS "calendar" JSONB NOT NULL DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS "technical" JSONB NOT NULL DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS "financial" JSONB NOT NULL DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS "insurance" JSONB NOT NULL DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS "last_saved_section" VARCHAR(40),
      ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
    `);

    await prisma.$executeRawUnsafe(`
      UPDATE "contract_information"
      SET
        "document_type" = COALESCE(NULLIF("document_type", ''), 'main'),
        "general" = COALESCE("general", '{}'::jsonb),
        "calendar" = COALESCE("calendar", '{}'::jsonb),
        "technical" = COALESCE("technical", '{}'::jsonb),
        "financial" = COALESCE("financial", '{}'::jsonb),
        "insurance" = COALESCE("insurance", '{}'::jsonb),
        "created_at" = COALESCE("created_at", CURRENT_TIMESTAMP),
        "updated_at" = COALESCE("updated_at", CURRENT_TIMESTAMP);
    `);

    await prisma.$executeRawUnsafe(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'contract_information_project_id_fkey'
        ) THEN
          ALTER TABLE "contract_information"
          ADD CONSTRAINT "contract_information_project_id_fkey"
          FOREIGN KEY ("project_id")
          REFERENCES "projects"("id")
          ON DELETE SET NULL
          ON UPDATE CASCADE;
        END IF;
      END $$;
    `);

    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "contract_information_project_id_idx"
      ON "contract_information"("project_id");
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "contract_information_document_type_idx"
      ON "contract_information"("document_type");
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "contract_information_parent_contract_id_idx"
      ON "contract_information"("parent_contract_id");
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "contract_information_related_letter_id_idx"
      ON "contract_information"("related_letter_id");
    `);
  })().catch((error) => {
    ensureContractSchemaPromise = null;
    throw error;
  });

  return ensureContractSchemaPromise;
}

async function buildContractData(body, existingId = "") {
  const id = normalizeId(body.id || existingId);
  const projectId = parseOptionalProjectId(body.projectId ?? body.project_id);
  const documentType = normalizeDocumentType(body.documentType ?? body.document_type);
  const parentContractId = trimString(body.parentContractId ?? body.parent_contract_id);
  const contractNo = trimString(body.contractNo ?? body.contract_no);

  if (projectId === undefined) return { error: "invalid_project_id" };
  if (!documentType) return { error: "invalid_document_type" };
  if (!projectId) return { error: "project_required" };
  if (documentType === "main" && !contractNo) return { error: "contract_no_required" };
  if (documentType !== "main" && !parentContractId) return { error: "parent_contract_required" };

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true },
  });
  if (!project) return { error: "project_not_found" };

  if (documentType !== "main") {
    const parent = await prisma.contractInformation.findUnique({
      where: { id: parentContractId },
      select: { id: true },
    });
    if (!parent) return { error: "parent_contract_not_found" };
  }

  if (documentType === "main" && contractNo) {
    const duplicate = await prisma.contractInformation.findFirst({
      where: {
        documentType: "main",
        contractNo,
        NOT: { id },
      },
      select: { id: true },
    });
    if (duplicate) return { error: "duplicate_contract_no" };
  }

  return {
    data: {
      id,
      projectId,
      documentType,
      contractNo: documentType === "main" ? contractNo : null,
      parentContractId: documentType === "main" ? null : parentContractId,
      relatedLetterId: trimString(body.relatedLetterId ?? body.related_letter_id) || null,
      general: plainObject(body.general),
      calendar: plainObject(body.calendar),
      technical: plainObject(body.technical),
      financial: plainObject(body.financial),
      insurance: plainObject(body.insurance),
      lastSavedSection: trimString(body.lastSavedSection ?? body.last_saved_section) || null,
    },
  };
}

export async function GET(request) {
  try {
    await ensureContractSchema();

    const url = new URL(request.url);
    const id = trimString(url.searchParams.get("id"));
    const projectId = parseOptionalProjectId(url.searchParams.get("projectId") || url.searchParams.get("project_id"));
    const documentType = normalizeDocumentType(url.searchParams.get("documentType") || url.searchParams.get("document_type") || "");

    if (projectId === undefined) return bad("invalid_project_id");
    if ((url.searchParams.has("documentType") || url.searchParams.has("document_type")) && !documentType) {
      return bad("invalid_document_type");
    }

    if (id) {
      const item = await prisma.contractInformation.findUnique({ where: { id } });
      if (!item) return bad("not_found", 404);
      return json({ item: mapRow(item) });
    }

    const where = {};
    if (projectId) where.projectId = projectId;
    if (documentType) where.documentType = documentType;

    const items = await prisma.contractInformation.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    });

    return json({ items: items.map(mapRow) });
  } catch (error) {
    const mapped = mapDatabaseError(error);
    if (mapped) return bad(mapped.error, mapped.status);
    console.error("contracts_get_error", error);
    return bad("internal_error", 500);
  }
}

export async function POST(request) {
  try {
    await ensureContractSchema();

    const body = await readJsonSafely(request);
    const built = await buildContractData(body);
    if (built.error) return bad(built.error);

    const item = await prisma.contractInformation.upsert({
      where: { id: built.data.id },
      create: built.data,
      update: built.data,
    });

    return json({ ok: true, item: mapRow(item), id: item.id });
  } catch (error) {
    if (error?.message === "invalid_json") return bad("invalid_json");
    const mapped = mapDatabaseError(error);
    if (mapped) return bad(mapped.error, mapped.status);
    console.error("contracts_post_error", error);
    return bad("internal_error", 500);
  }
}

export async function PATCH(request) {
  try {
    await ensureContractSchema();

    const body = await readJsonSafely(request);
    const id = trimString(body.id);
    if (!id) return bad("invalid_id");

    const existing = await prisma.contractInformation.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) return bad("not_found", 404);

    const built = await buildContractData(body, id);
    if (built.error) return bad(built.error);

    const item = await prisma.contractInformation.update({
      where: { id },
      data: built.data,
    });

    return json({ ok: true, item: mapRow(item), id: item.id });
  } catch (error) {
    if (error?.message === "invalid_json") return bad("invalid_json");
    const mapped = mapDatabaseError(error);
    if (mapped) return bad(mapped.error, mapped.status);
    console.error("contracts_patch_error", error);
    return bad("internal_error", 500);
  }
}

export async function DELETE(request) {
  try {
    await ensureContractSchema();

    const url = new URL(request.url);
    let id = trimString(url.searchParams.get("id"));
    if (!id) {
      const body = await readJsonSafely(request);
      id = trimString(body.id);
    }
    if (!id) return bad("invalid_id");

    const existing = await prisma.contractInformation.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) return bad("not_found", 404);

    await prisma.$transaction([
      prisma.contractInformation.deleteMany({ where: { parentContractId: id } }),
      prisma.contractInformation.delete({ where: { id } }),
    ]);

    return json({ ok: true, id });
  } catch (error) {
    if (error?.message === "invalid_json") return bad("invalid_json");
    const mapped = mapDatabaseError(error);
    if (mapped) return bad(mapped.error, mapped.status);
    console.error("contracts_delete_error", error);
    return bad("internal_error", 500);
  }
}
