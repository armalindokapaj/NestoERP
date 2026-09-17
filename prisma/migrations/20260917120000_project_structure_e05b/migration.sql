-- E-05B: the physical structure of a project — buildings, floors, units — and
-- each company's list of unit types.
--
-- Purely additive. Nothing held units before (no legacy rows to map, E-05B §143),
-- so no building, floor or unit is created here; only every existing company's
-- default unit types (config/unit-types.ts), as E-05A did for project types.
--
-- Composite foreign keys hold the derived ownership columns to their parents,
-- in the database rather than only in the service (E-05B §68-§70, §79):
--   building (projectId, companyId) → project  (id, companyId)
--   floor    (buildingId, projectId) → building (id, projectId)
--   unit     (floorId, projectId)    → floor    (id, projectId)
--   unit     (unitTypeId, companyId) → unit type (id, companyId)
-- so a floor cannot sit on another project's building, and a unit cannot move
-- to another project's floor or take another company's type.

-- CreateEnum
CREATE TYPE "FloorLevelType" AS ENUM ('BASEMENT', 'GROUND', 'STANDARD', 'MEZZANINE', 'TECHNICAL', 'ROOF', 'OTHER');

-- CreateEnum
CREATE TYPE "UnitTypeCategory" AS ENUM ('RESIDENTIAL', 'COMMERCIAL', 'PARKING', 'STORAGE', 'LAND', 'OTHER');

-- CreateEnum
CREATE TYPE "UnitOrientation" AS ENUM ('N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW', 'MULTI', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "UnitPosition" AS ENUM ('FRONT', 'REAR', 'CORNER', 'INTERNAL', 'LEFT', 'RIGHT', 'CENTER', 'OTHER');

-- CreateTable
CREATE TABLE "project_unit_types" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "category" "UnitTypeCategory" NOT NULL DEFAULT 'OTHER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_unit_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_buildings" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "code" TEXT,
    "codeKey" TEXT,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_buildings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_floors" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "number" INTEGER,
    "name" TEXT NOT NULL,
    "levelType" "FloorLevelType" NOT NULL,
    "floorKey" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "elevation" DECIMAL(10,2),
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_floors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_units" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "floorId" TEXT NOT NULL,
    "unitCode" TEXT NOT NULL,
    "unitCodeKey" TEXT NOT NULL,
    "name" TEXT,
    "unitTypeId" TEXT NOT NULL,
    "position" "UnitPosition",
    "orientation" "UnitOrientation",
    "internalArea" DECIMAL(12,2),
    "grossArea" DECIMAL(12,2),
    "saleableArea" DECIMAL(12,2),
    "outdoorArea" DECIMAL(12,2),
    "balconyArea" DECIMAL(12,2),
    "terraceArea" DECIMAL(12,2),
    "gardenArea" DECIMAL(12,2),
    "commonAreaAllocation" DECIMAL(12,2),
    "rooms" INTEGER,
    "bedrooms" INTEGER,
    "bathrooms" INTEGER,
    "attributes" JSONB,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_units_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_unit_types_companyId_isActive_sortOrder_idx" ON "project_unit_types"("companyId", "isActive", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "project_unit_types_companyId_code_key" ON "project_unit_types"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "project_unit_types_companyId_name_key" ON "project_unit_types"("companyId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "project_unit_types_id_companyId_key" ON "project_unit_types"("id", "companyId");

-- CreateIndex
CREATE INDEX "project_buildings_companyId_projectId_sortOrder_idx" ON "project_buildings"("companyId", "projectId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "project_buildings_id_projectId_key" ON "project_buildings"("id", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "project_buildings_projectId_nameKey_key" ON "project_buildings"("projectId", "nameKey");

-- CreateIndex
CREATE UNIQUE INDEX "project_buildings_projectId_codeKey_key" ON "project_buildings"("projectId", "codeKey");

-- CreateIndex
CREATE INDEX "project_floors_buildingId_sortOrder_idx" ON "project_floors"("buildingId", "sortOrder");

-- CreateIndex
CREATE INDEX "project_floors_companyId_projectId_idx" ON "project_floors"("companyId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "project_floors_id_projectId_key" ON "project_floors"("id", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "project_floors_buildingId_floorKey_key" ON "project_floors"("buildingId", "floorKey");

-- CreateIndex
CREATE INDEX "project_units_floorId_sortOrder_idx" ON "project_units"("floorId", "sortOrder");

-- CreateIndex
CREATE INDEX "project_units_companyId_projectId_idx" ON "project_units"("companyId", "projectId");

-- CreateIndex
CREATE INDEX "project_units_unitTypeId_idx" ON "project_units"("unitTypeId");

-- CreateIndex
CREATE INDEX "project_units_projectId_saleableArea_idx" ON "project_units"("projectId", "saleableArea");

-- CreateIndex
CREATE INDEX "project_units_projectId_internalArea_idx" ON "project_units"("projectId", "internalArea");

-- CreateIndex
CREATE INDEX "project_units_projectId_orientation_idx" ON "project_units"("projectId", "orientation");

-- CreateIndex
CREATE UNIQUE INDEX "project_units_projectId_unitCodeKey_key" ON "project_units"("projectId", "unitCodeKey");

-- CreateIndex
CREATE UNIQUE INDEX "projects_id_companyId_key" ON "projects"("id", "companyId");

-- AddForeignKey
ALTER TABLE "project_unit_types" ADD CONSTRAINT "project_unit_types_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_buildings" ADD CONSTRAINT "project_buildings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_buildings" ADD CONSTRAINT "project_buildings_projectId_companyId_fkey" FOREIGN KEY ("projectId", "companyId") REFERENCES "projects"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_floors" ADD CONSTRAINT "project_floors_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_floors" ADD CONSTRAINT "project_floors_projectId_companyId_fkey" FOREIGN KEY ("projectId", "companyId") REFERENCES "projects"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_floors" ADD CONSTRAINT "project_floors_buildingId_projectId_fkey" FOREIGN KEY ("buildingId", "projectId") REFERENCES "project_buildings"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_units" ADD CONSTRAINT "project_units_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_units" ADD CONSTRAINT "project_units_projectId_companyId_fkey" FOREIGN KEY ("projectId", "companyId") REFERENCES "projects"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_units" ADD CONSTRAINT "project_units_floorId_projectId_fkey" FOREIGN KEY ("floorId", "projectId") REFERENCES "project_floors"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_units" ADD CONSTRAINT "project_units_unitTypeId_companyId_fkey" FOREIGN KEY ("unitTypeId", "companyId") REFERENCES "project_unit_types"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Every existing company starts with the default unit types. Ids are derived
-- from the company and the code, so the migration is deterministic on every
-- copy of the database.
INSERT INTO "project_unit_types" ("id", "companyId", "name", "code", "category", "sortOrder", "createdAt", "updatedAt")
SELECT 'utype_' || substr(md5(c."id" || ':' || d."code"), 1, 24), c."id", d."name", d."code", d."category"::"UnitTypeCategory", d."sortOrder", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "companies" AS c
CROSS JOIN (
  VALUES
    ('Apartment', 'APARTMENT', 'RESIDENTIAL', 1),
    ('Penthouse', 'PENTHOUSE', 'RESIDENTIAL', 2),
    ('Villa', 'VILLA', 'RESIDENTIAL', 3),
    ('Office', 'OFFICE', 'COMMERCIAL', 4),
    ('Shop', 'SHOP', 'COMMERCIAL', 5),
    ('Parking', 'PARKING', 'PARKING', 6),
    ('Garage', 'GARAGE', 'PARKING', 7),
    ('Storage', 'STORAGE', 'STORAGE', 8),
    ('Land', 'LAND', 'LAND', 9),
    ('Other', 'OTHER', 'OTHER', 10)
) AS d("name", "code", "category", "sortOrder")
ON CONFLICT DO NOTHING;
