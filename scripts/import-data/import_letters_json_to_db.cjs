const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

function normalizeText(v) {
  return String(v ?? "").trim();
}

function normalizeType(raw) {
  const s = normalizeText(raw);
  if (!s) return "incoming";
  if (s.includes("داخلی")) return "internal";
  if (s.includes("صادر")) return "outgoing";
  if (s.includes("وارد")) return "incoming";
  const en = s.toLowerCase();
  if (en.includes("internal")) return "internal";
  if (en.includes("out")) return "outgoing";
  return "incoming";
}

function isTruthyAttachment(v) {
  const s = normalizeText(v).toLowerCase();
  if (!s) return false;
  if (["0", "false", "no", "none", "null", "-"].includes(s)) return false;
  return true;
}

function dedupeKey(item) {
  return [
    normalizeText(item.kind),
    normalizeText(item.letter_no),
    normalizeText(item.letter_date),
    normalizeText(item.secretariat_no),
    normalizeText(item.secretariat_date),
    normalizeText(item.subject),
  ].join("|");
}

async function ensureSchema(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS "TagCategory" (
      id SERIAL PRIMARY KEY,
      scope TEXT NOT NULL,
      label TEXT NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS "TagCategory_scope_label_key"
    ON "TagCategory"(scope, label);
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS "TagCategory_scope_idx"
    ON "TagCategory"(scope);
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS "Letter" (
      id SERIAL PRIMARY KEY,
      kind TEXT NOT NULL,
      doc_class TEXT NULL,
      classification_id INTEGER NULL REFERENCES "TagCategory"(id) ON DELETE SET NULL,
      category TEXT NULL,
      "projectId" INTEGER NULL,
      internal_unit_id INTEGER NULL,
      "letterNo" TEXT NULL,
      "letterDate" TEXT NULL,
      "fromName" TEXT NULL,
      "toName" TEXT NULL,
      "orgName" TEXT NULL,
      subject TEXT NULL,
      "hasAttachment" BOOLEAN NOT NULL DEFAULT false,
      "attachmentTitle" TEXT NULL,
      "returnToIds" JSONB NULL,
      "piroIds" JSONB NULL,
      "tagIds" JSONB NULL,
      "secretariatDate" TEXT NULL,
      "secretariatNo" TEXT NULL,
      "receiverName" TEXT NULL,
      secretariat_note TEXT NULL,
      attachments JSONB NULL,
      "createdBy" TEXT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS "Letter_kind_idx" ON "Letter"(kind);`);
  await client.query(`CREATE INDEX IF NOT EXISTS "Letter_projectId_idx" ON "Letter"("projectId");`);
  await client.query(`CREATE INDEX IF NOT EXISTS "Letter_createdAt_idx" ON "Letter"("createdAt");`);
  await client.query(`CREATE INDEX IF NOT EXISTS "Letter_classification_id_idx" ON "Letter"(classification_id);`);
  await client.query(`CREATE INDEX IF NOT EXISTS "Letter_internal_unit_id_idx" ON "Letter"(internal_unit_id);`);
}

async function readProjects(client) {
  const mapByCode = new Map();
  const mapByName = new Map();
  try {
    const r = await client.query(`SELECT id, code, name FROM projects`);
    for (const row of r.rows) {
      mapByCode.set(normalizeText(row.code), Number(row.id));
      mapByName.set(normalizeText(row.name), Number(row.id));
    }
  } catch {
    // projects table may not exist in some environments.
  }
  return { mapByCode, mapByName };
}

async function readExistingKeys(client) {
  const keys = new Set();
  const r = await client.query(`
    SELECT kind, "letterNo", "letterDate", "secretariatNo", "secretariatDate", subject
    FROM "Letter"
  `);
  for (const row of r.rows) {
    keys.add(
      dedupeKey({
        kind: row.kind,
        letter_no: row.letterNo,
        letter_date: row.letterDate,
        secretariat_no: row.secretariatNo,
        secretariat_date: row.secretariatDate,
        subject: row.subject,
      })
    );
  }
  return keys;
}

async function run() {
  const jsonPath = path.resolve(
    process.argv[2] || path.join(__dirname, "letters_from_xlsx_1404.json")
  );
  if (!fs.existsSync(jsonPath)) {
    throw new Error(`JSON file not found: ${jsonPath}`);
  }

  const raw = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  const rows = Array.isArray(raw?.rows) ? raw.rows : [];
  if (!rows.length) {
    throw new Error("No rows found in JSON file.");
  }

  const connectionString =
    process.env.DATABASE_URL || "postgresql://postgres:123321@localhost:5432/ipm_local";
  const client = new Client({ connectionString });
  await client.connect();

  const stats = {
    totalRows: rows.length,
    inserted: 0,
    skippedDuplicate: 0,
    skippedEmpty: 0,
    unmappedProjects: 0,
  };
  const unmappedProjectSamples = new Set();

  try {
    await client.query("BEGIN");

    await ensureSchema(client);

    const { mapByCode, mapByName } = await readProjects(client);
    const existing = await readExistingKeys(client);

    for (const src of rows) {
      const kind = normalizeType(src.kind_raw);
      const letter_no = normalizeText(src.letter_no);
      const letter_date = normalizeText(src.letter_date);
      const secretariat_no = normalizeText(src.secretariat_no);
      const secretariat_date = normalizeText(src.secretariat_date);
      const subject = normalizeText(src.subject);

      if (!letter_no && !secretariat_no && !subject) {
        stats.skippedEmpty += 1;
        continue;
      }

      const key = dedupeKey({
        kind,
        letter_no,
        letter_date,
        secretariat_no,
        secretariat_date,
        subject,
      });
      if (existing.has(key)) {
        stats.skippedDuplicate += 1;
        continue;
      }

      const projectCode = normalizeText(src.project_code);
      const projectName = normalizeText(src.project_name);
      let projectId = null;
      if (projectCode && mapByCode.has(projectCode)) {
        projectId = mapByCode.get(projectCode);
      } else if (projectName && mapByName.has(projectName)) {
        projectId = mapByName.get(projectName);
      } else if (projectCode || projectName) {
        stats.unmappedProjects += 1;
        if (unmappedProjectSamples.size < 20) {
          unmappedProjectSamples.add(`${projectCode} | ${projectName}`);
        }
      }

      const attachmentFlag = normalizeText(src.attachment_flag);
      const attachmentDesc = normalizeText(src.attachment_desc);
      const hasAttachment = isTruthyAttachment(attachmentFlag) || !!attachmentDesc;
      let attachmentTitle = attachmentDesc;
      if (!attachmentTitle && hasAttachment && attachmentFlag && attachmentFlag !== "1") {
        attachmentTitle = attachmentFlag;
      }

      await client.query(
        `
          INSERT INTO "Letter" (
            kind,
            doc_class,
            classification_id,
            category,
            "projectId",
            internal_unit_id,
            "letterNo",
            "letterDate",
            "fromName",
            "toName",
            "orgName",
            subject,
            "hasAttachment",
            "attachmentTitle",
            "returnToIds",
            "piroIds",
            "tagIds",
            "secretariatDate",
            "secretariatNo",
            "receiverName",
            secretariat_note,
            attachments,
            "createdBy",
            "createdAt",
            "updatedAt"
          )
          VALUES (
            $1, NULL, NULL, NULL, $2, NULL, $3, $4, $5, $6, $7, $8, $9, $10,
            $11::jsonb, $12::jsonb, $13::jsonb, $14, $15, NULL, NULL, $16::jsonb, NULL,
            CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
          )
        `,
        [
          kind,
          projectId,
          letter_no || null,
          letter_date || null,
          normalizeText(src.from_name) || null,
          normalizeText(src.to_name) || null,
          normalizeText(src.org_name) || null,
          subject || null,
          hasAttachment,
          attachmentTitle || null,
          JSON.stringify([]),
          JSON.stringify([]),
          JSON.stringify([]),
          secretariat_date || null,
          secretariat_no || null,
          JSON.stringify([]),
        ]
      );

      existing.add(key);
      stats.inserted += 1;
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    await client.end();
  }

  console.log(JSON.stringify({ stats, unmappedProjectSamples: [...unmappedProjectSamples] }, null, 2));
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
