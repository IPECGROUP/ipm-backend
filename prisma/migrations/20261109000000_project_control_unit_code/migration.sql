-- Assign a stable workflow identity to the existing unit without touching its
-- display name, relationships, or request history.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Unit" WHERE "id" <> 27 AND "code" = 'project_control') THEN
    RAISE EXCEPTION 'project_control code is already assigned to another unit';
  END IF;

  UPDATE "Unit"
  SET "code" = 'project_control'
  WHERE "id" = 27
    AND "code" IS NULL
    AND "name" IN ('برنامه ریزی و کنترل پروژه', 'برنامه‌ریزی و کنترل پروژه', 'برنامه ریزی', 'برنامه‌ریزی');
END $$;
