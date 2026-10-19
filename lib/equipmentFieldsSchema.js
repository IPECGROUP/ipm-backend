import { prisma } from "./prisma";

let ready;

export function ensureEquipmentFieldTables() {
  if (!ready) ready = (async () => {
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS equipment_field_categories (
      id SERIAL PRIMARY KEY, name VARCHAR(120) NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS equipment_field_titles (
      id SERIAL PRIMARY KEY, category_id INTEGER REFERENCES equipment_field_categories(id) ON DELETE SET NULL,
      name VARCHAR(120) NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(category_id, name)
    )`);
    await prisma.$executeRawUnsafe(`ALTER TABLE equipment_field_titles ALTER COLUMN category_id DROP NOT NULL`);
    await prisma.$executeRawUnsafe(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'equipment_field_titles_category_id_fkey' AND confdeltype = 'n') THEN
        ALTER TABLE equipment_field_titles DROP CONSTRAINT IF EXISTS equipment_field_titles_category_id_fkey;
        ALTER TABLE equipment_field_titles ADD CONSTRAINT equipment_field_titles_category_id_fkey
          FOREIGN KEY (category_id) REFERENCES equipment_field_categories(id) ON DELETE SET NULL;
      END IF;
    END $$`);
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS equipment_field_definitions (
      id SERIAL PRIMARY KEY, category_id INTEGER REFERENCES equipment_field_categories(id) ON DELETE RESTRICT,
      title_id INTEGER NOT NULL REFERENCES equipment_field_titles(id) ON DELETE CASCADE,
      name VARCHAR(120) NOT NULL, field_type VARCHAR(20) NOT NULL DEFAULT 'text',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(category_id, title_id, name)
    )`);
    await prisma.$executeRawUnsafe(`ALTER TABLE equipment_field_definitions ADD COLUMN IF NOT EXISTS category_id INTEGER`);
    await prisma.$executeRawUnsafe(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'equipment_field_definitions_category_id_fkey') THEN
        ALTER TABLE equipment_field_definitions ADD CONSTRAINT equipment_field_definitions_category_id_fkey
          FOREIGN KEY (category_id) REFERENCES equipment_field_categories(id) ON DELETE RESTRICT;
      END IF;
    END $$`);
    await prisma.$executeRawUnsafe(`ALTER TABLE equipment_field_definitions DROP CONSTRAINT IF EXISTS equipment_field_definitions_title_id_name_key`);
    await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS equipment_field_definitions_category_title_name_key
      ON equipment_field_definitions (category_id, title_id, name)`);
    await prisma.$executeRawUnsafe(`UPDATE equipment_field_definitions SET field_type = 'text' WHERE field_type <> 'text'`);
  })().catch((error) => { ready = null; throw error; });
  return ready;
}
