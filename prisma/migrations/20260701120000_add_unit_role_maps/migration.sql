CREATE TABLE "UnitRoleMap" (
  "unitId" INTEGER NOT NULL,
  "roleId" INTEGER NOT NULL,

  CONSTRAINT "UnitRoleMap_pkey" PRIMARY KEY ("unitId", "roleId")
);

CREATE INDEX "UnitRoleMap_roleId_idx" ON "UnitRoleMap"("roleId");

ALTER TABLE "UnitRoleMap"
  ADD CONSTRAINT "UnitRoleMap_unitId_fkey"
  FOREIGN KEY ("unitId") REFERENCES "Unit"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UnitRoleMap"
  ADD CONSTRAINT "UnitRoleMap_roleId_fkey"
  FOREIGN KEY ("roleId") REFERENCES "UserRole"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
