import { prisma } from "./prisma";
import { ensureEquipmentFieldTables } from "./equipmentFieldsSchema";

let ready;

export function ensureEquipmentSpecificationsTable() {
  if (!ready) ready = (async () => {
    await ensureEquipmentFieldTables();
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS equipment_specifications (
      id SERIAL PRIMARY KEY,
      category_id INTEGER NOT NULL REFERENCES equipment_field_categories(id) ON DELETE RESTRICT,
      parent_id INTEGER REFERENCES equipment_specifications(id) ON DELETE RESTRICT,
      code VARCHAR(120) NOT NULL,
      name VARCHAR(120) NOT NULL,
      english_name VARCHAR(120),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(category_id, code)
    )`);
    await prisma.$executeRawUnsafe(`ALTER TABLE equipment_specifications ADD COLUMN IF NOT EXISTS english_name VARCHAR(120)`);
  })().catch((error) => { ready = null; throw error; });
  return ready;
}
