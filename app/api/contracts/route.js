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

function parseStringList(value) {
  const raw = (() => {
    if (Array.isArray(value)) return value;
    if (typeof value === "string" && value.trim().startsWith("[")) {
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return value ? [value] : [];
  })();

  const seen = new Set();
  return raw
    .map((item) => trimString(item))
    .filter((item) => {
      if (!item || seen.has(item)) return false;
      seen.add(item);
      return true;
    });
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

function resolveDocumentType(value, parentContractId, subContractNo) {
  const type = normalizeDocumentType(value);
  if (parentContractId && subContractNo) return "sub";
  if (type === "main" && parentContractId) return subContractNo ? "sub" : "appendix";
  return type;
}

function normalizeId(value) {
  const id = trimString(value);
  return id || `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function mapRow(row) {
  if (!row) return null;
  const projectId = row.projectId ?? row.project_id;
  const documentType = row.documentType ?? row.document_type;
  const contractNo = row.contractNo ?? row.contract_no;
  const subContractNo = row.subContractNo ?? row.sub_contract_no;
  const parentContractId = row.parentContractId ?? row.parent_contract_id;
  const relatedLetterId = row.relatedLetterId ?? row.related_letter_id;
  const relatedLetterIds = parseStringList(row.relatedLetterIds ?? row.related_letter_ids ?? relatedLetterId);
  const lastSavedSection = row.lastSavedSection ?? row.last_saved_section;
  const createdAt = row.createdAt ?? row.created_at;
  const updatedAt = row.updatedAt ?? row.updated_at;
  return {
    id: row.id,
    projectId: projectId == null ? "" : String(projectId),
    documentType: documentType || "main",
    contractNo: contractNo || "",
    subContractNo: subContractNo || "",
    parentContractId: parentContractId || "",
    relatedLetterId: relatedLetterId || "",
    relatedLetterIds,
    general: plainObject(row.general),
    calendar: plainObject(row.calendar),
    technical: plainObject(row.technical),
    financial: plainObject(row.financial),
    insurance: plainObject(row.insurance),
    lastSavedSection: lastSavedSection || "",
    createdAt,
    updatedAt,
  };
}

const CONTRACT_SELECT = Prisma.sql`
  SELECT
    "id",
    "project_id" AS "projectId",
    "document_type" AS "documentType",
    "contract_no" AS "contractNo",
    "sub_contract_no" AS "subContractNo",
    "parent_contract_id" AS "parentContractId",
    "related_letter_id" AS "relatedLetterId",
    "related_letter_ids" AS "relatedLetterIds",
    "general",
    "calendar",
    "technical",
    "financial",
    "insurance",
    "last_saved_section" AS "lastSavedSection",
    "created_at" AS "createdAt",
    "updated_at" AS "updatedAt"
  FROM "contract_information"
`;

async function getContractById(id) {
  const rows = await prisma.$queryRaw`
    ${CONTRACT_SELECT}
    WHERE "id" = ${id}
    LIMIT 1
  `;
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function projectExists(projectId) {
  const rows = await prisma.$queryRaw`
    SELECT "id"
    FROM "projects"
    WHERE "id" = ${projectId}
    LIMIT 1
  `;
  return Array.isArray(rows) && rows.length > 0;
}

async function findDuplicateMainContract(id, contractNo) {
  const rows = await prisma.$queryRaw`
    SELECT "id"
    FROM "contract_information"
    WHERE "document_type" = 'main'
      AND "contract_no" = ${contractNo}
      AND "id" <> ${id}
    LIMIT 1
  `;
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function findExistingMainContractForProject(id, projectId) {
  const rows = await prisma.$queryRaw`
    SELECT "id"
    FROM "contract_information"
    WHERE "document_type" = 'main'
      AND "project_id" = ${projectId}
      AND "id" <> ${id}
    LIMIT 1
  `;
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function listContracts({ projectId, documentType }) {
  if (projectId && documentType) {
    return prisma.$queryRaw`
      ${CONTRACT_SELECT}
      WHERE "project_id" = ${projectId}
        AND "document_type" = ${documentType}
      ORDER BY "updated_at" DESC, "created_at" DESC
    `;
  }

  if (projectId) {
    return prisma.$queryRaw`
      ${CONTRACT_SELECT}
      WHERE "project_id" = ${projectId}
      ORDER BY "updated_at" DESC, "created_at" DESC
    `;
  }

  if (documentType) {
    return prisma.$queryRaw`
      ${CONTRACT_SELECT}
      WHERE "document_type" = ${documentType}
      ORDER BY "updated_at" DESC, "created_at" DESC
    `;
  }

  return prisma.$queryRaw`
    ${CONTRACT_SELECT}
    ORDER BY "updated_at" DESC, "created_at" DESC
  `;
}

async function upsertContract(data) {
  const rows = await prisma.$queryRaw`
    INSERT INTO "contract_information" (
      "id",
      "project_id",
      "document_type",
      "contract_no",
      "sub_contract_no",
      "parent_contract_id",
      "related_letter_id",
      "related_letter_ids",
      "general",
      "calendar",
      "technical",
      "financial",
      "insurance",
      "last_saved_section",
      "created_at",
      "updated_at"
    )
    VALUES (
      ${data.id},
      ${data.projectId},
      ${data.documentType},
      ${data.contractNo},
      ${data.subContractNo},
      ${data.parentContractId},
      ${data.relatedLetterId},
      ${JSON.stringify(data.relatedLetterIds)}::jsonb,
      ${JSON.stringify(data.general)}::jsonb,
      ${JSON.stringify(data.calendar)}::jsonb,
      ${JSON.stringify(data.technical)}::jsonb,
      ${JSON.stringify(data.financial)}::jsonb,
      ${JSON.stringify(data.insurance)}::jsonb,
      ${data.lastSavedSection},
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )
    ON CONFLICT ("id") DO UPDATE SET
      "project_id" = EXCLUDED."project_id",
      "document_type" = EXCLUDED."document_type",
      "contract_no" = EXCLUDED."contract_no",
      "sub_contract_no" = EXCLUDED."sub_contract_no",
      "parent_contract_id" = EXCLUDED."parent_contract_id",
      "related_letter_id" = EXCLUDED."related_letter_id",
      "related_letter_ids" = EXCLUDED."related_letter_ids",
      "general" = EXCLUDED."general",
      "calendar" = EXCLUDED."calendar",
      "technical" = EXCLUDED."technical",
      "financial" = EXCLUDED."financial",
      "insurance" = EXCLUDED."insurance",
      "last_saved_section" = EXCLUDED."last_saved_section",
      "updated_at" = CURRENT_TIMESTAMP
    RETURNING
      "id",
      "project_id" AS "projectId",
      "document_type" AS "documentType",
      "contract_no" AS "contractNo",
      "sub_contract_no" AS "subContractNo",
      "parent_contract_id" AS "parentContractId",
      "related_letter_id" AS "relatedLetterId",
      "related_letter_ids" AS "relatedLetterIds",
      "general",
      "calendar",
      "technical",
      "financial",
      "insurance",
      "last_saved_section" AS "lastSavedSection",
      "created_at" AS "createdAt",
      "updated_at" AS "updatedAt"
  `;
  return Array.isArray(rows) ? rows[0] || null : null;
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
        "sub_contract_no" TEXT,
        "parent_contract_id" TEXT,
        "related_letter_id" TEXT,
        "related_letter_ids" JSONB NOT NULL DEFAULT '[]'::jsonb,
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
      ADD COLUMN IF NOT EXISTS "sub_contract_no" TEXT,
      ADD COLUMN IF NOT EXISTS "parent_contract_id" TEXT,
      ADD COLUMN IF NOT EXISTS "related_letter_id" TEXT,
      ADD COLUMN IF NOT EXISTS "related_letter_ids" JSONB NOT NULL DEFAULT '[]'::jsonb,
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
        "document_type" = CASE
          WHEN NULLIF("parent_contract_id", '') IS NOT NULL
            AND NULLIF("sub_contract_no", '') IS NOT NULL
            THEN 'sub'
          WHEN NULLIF("parent_contract_id", '') IS NOT NULL
            AND COALESCE(NULLIF("document_type", ''), 'main') = 'main'
            THEN 'appendix'
          ELSE COALESCE(NULLIF("document_type", ''), 'main')
        END,
        "related_letter_ids" = CASE
          WHEN jsonb_typeof(COALESCE("related_letter_ids", '[]'::jsonb)) = 'array'
            AND jsonb_array_length(COALESCE("related_letter_ids", '[]'::jsonb)) > 0
            THEN COALESCE("related_letter_ids", '[]'::jsonb)
          WHEN NULLIF("related_letter_id", '') IS NOT NULL
            THEN jsonb_build_array("related_letter_id")
          ELSE '[]'::jsonb
        END,
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
  const parentContractId = trimString(body.parentContractId ?? body.parent_contract_id);
  const contractNo = trimString(body.contractNo ?? body.contract_no);
  const subContractNo = trimString(body.subContractNo ?? body.sub_contract_no);
  const documentType = resolveDocumentType(body.documentType ?? body.document_type, parentContractId, subContractNo);

  if (projectId === undefined) return { error: "invalid_project_id" };
  if (!documentType) return { error: "invalid_document_type" };
  if (!projectId) return { error: "project_required" };
  if (documentType === "main" && !contractNo) return { error: "contract_no_required" };
  if (documentType !== "main" && !parentContractId) return { error: "parent_contract_required" };
  if (documentType === "sub" && !subContractNo) return { error: "sub_contract_no_required" };

  if (!(await projectExists(projectId))) return { error: "project_not_found" };

  if (documentType !== "main") {
    const parent = await getContractById(parentContractId);
    if (!parent) return { error: "parent_contract_not_found" };
    const parentProjectId = parent.projectId ?? parent.project_id;
    if (String(parentProjectId || "") !== String(projectId || "")) return { error: "parent_project_mismatch" };
  }

  if (documentType === "main" && contractNo) {
    const existingProjectMain = await findExistingMainContractForProject(id, projectId);
    if (existingProjectMain) return { error: "main_contract_exists_for_project" };

    const duplicate = await findDuplicateMainContract(id, contractNo);
    if (duplicate) return { error: "duplicate_contract_no" };
  }

  const relatedLetterIds = parseStringList(
    body.relatedLetterIds ?? body.related_letter_ids ?? body.relatedLetterId ?? body.related_letter_id
  );

  return {
    data: {
      id,
      projectId,
      documentType,
      contractNo: documentType === "main" ? contractNo : null,
      subContractNo: documentType === "sub" ? subContractNo : null,
      parentContractId: documentType === "main" ? null : parentContractId,
      relatedLetterId: relatedLetterIds[0] || null,
      relatedLetterIds,
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
      const item = await getContractById(id);
      if (!item) return bad("not_found", 404);
      return json({ item: mapRow(item) });
    }

    const items = await listContracts({ projectId, documentType });

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

    const item = await upsertContract(built.data);

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

    const existing = await getContractById(id);
    if (!existing) return bad("not_found", 404);

    const built = await buildContractData(body, id);
    if (built.error) return bad(built.error);

    const item = await upsertContract(built.data);

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

    const existing = await getContractById(id);
    if (!existing) return bad("not_found", 404);

    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        DELETE FROM "contract_information"
        WHERE "parent_contract_id" = ${id}
      `;
      await tx.$executeRaw`
        DELETE FROM "contract_information"
        WHERE "id" = ${id}
      `;
    });

    return json({ ok: true, id });
  } catch (error) {
    if (error?.message === "invalid_json") return bad("invalid_json");
    const mapped = mapDatabaseError(error);
    if (mapped) return bad(mapped.error, mapped.status);
    console.error("contracts_delete_error", error);
    return bad("internal_error", 500);
  }
}
